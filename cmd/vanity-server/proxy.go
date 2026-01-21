package main

import (
	"bytes"
	"compress/gzip"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
)

// ReverseProxy handles proxying requests to the upstream server
type ReverseProxy struct {
	upstreamURL *url.URL
	proxy       *httputil.ReverseProxy
}

// NewReverseProxy creates a new reverse proxy for the given upstream URL
func NewReverseProxy(upstream string) *ReverseProxy {
	upstreamURL, err := url.Parse(upstream)
	if err != nil {
		log.Fatalf("Invalid upstream URL: %v", err)
	}

	rp := &ReverseProxy{
		upstreamURL: upstreamURL,
	}

	proxy := httputil.NewSingleHostReverseProxy(upstreamURL)
	proxy.ModifyResponse = rp.modifyResponse
	proxy.ErrorHandler = rp.errorHandler

	rp.proxy = proxy
	return rp
}

// ServeHTTP proxies the request to the specified target path
func (rp *ReverseProxy) ServeHTTP(w http.ResponseWriter, r *http.Request, targetPath string) {
	// Modify the request to point to the target path
	r.URL.Path = targetPath
	r.URL.Host = rp.upstreamURL.Host
	r.URL.Scheme = rp.upstreamURL.Scheme
	r.Host = rp.upstreamURL.Host

	// Remove any compression headers to get uncompressed response for rewriting
	r.Header.Del("Accept-Encoding")

	rp.proxy.ServeHTTP(w, r)
}

// modifyResponse rewrites links in HTML responses
func (rp *ReverseProxy) modifyResponse(resp *http.Response) error {
	contentType := resp.Header.Get("Content-Type")

	// Only modify HTML responses
	if !strings.Contains(contentType, "text/html") {
		return nil
	}

	// Read the body
	var body []byte
	var err error

	// Handle gzipped responses
	if resp.Header.Get("Content-Encoding") == "gzip" {
		reader, err := gzip.NewReader(resp.Body)
		if err != nil {
			return err
		}
		body, err = io.ReadAll(reader)
		reader.Close()
		if err != nil {
			return err
		}
		resp.Header.Del("Content-Encoding")
	} else {
		body, err = io.ReadAll(resp.Body)
		if err != nil {
			return err
		}
	}
	resp.Body.Close()

	// Rewrite links
	upstream := rp.upstreamURL.String()
	modified := rewriteLinks(string(body), upstream)

	// Set the new body
	resp.Body = io.NopCloser(strings.NewReader(modified))
	resp.ContentLength = int64(len(modified))
	resp.Header.Set("Content-Length", strconv.Itoa(len(modified)))

	return nil
}

// errorHandler handles proxy errors
func (rp *ReverseProxy) errorHandler(w http.ResponseWriter, r *http.Request, err error) {
	log.Printf("Proxy error: %v", err)
	http.Error(w, "Bad Gateway", http.StatusBadGateway)
}

// rewriteLinks converts relative URLs to absolute URLs pointing to upstream
func rewriteLinks(html, upstream string) string {
	// Common patterns to rewrite:
	// href="/ → href="https://upstream/
	// src="/ → src="https://upstream/
	// action="/ → action="https://upstream/

	var result bytes.Buffer
	result.Grow(len(html) + 1024)

	i := 0
	for i < len(html) {
		// Look for attribute patterns
		found := false
		for _, attr := range []string{`href="/`, `src="/`, `action="/`} {
			if i+len(attr) <= len(html) && html[i:i+len(attr)] == attr {
				// Write the attribute name and opening quote
				attrName := attr[:len(attr)-1] // e.g., `href="`
				result.WriteString(attrName)
				result.WriteString(upstream)
				result.WriteByte('/')
				i += len(attr)
				found = true
				break
			}
		}

		// Also handle single-quoted attributes
		if !found {
			for _, attr := range []string{`href='/`, `src='/`, `action='/`} {
				if i+len(attr) <= len(html) && html[i:i+len(attr)] == attr {
					attrName := attr[:len(attr)-1]
					result.WriteString(attrName)
					result.WriteString(upstream)
					result.WriteByte('/')
					i += len(attr)
					found = true
					break
				}
			}
		}

		if !found {
			result.WriteByte(html[i])
			i++
		}
	}

	return result.String()
}
