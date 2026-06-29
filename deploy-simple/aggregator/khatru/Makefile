.PHONY: build test vet run clean

BINARY := market-agg-relay

## build: compile the relay binary
build:
	go build -o $(BINARY) .

## test: run the full test suite
test:
	go test ./...

## vet: run go vet
vet:
	go vet ./...

## run: build then run with config from the environment (SEED_NPUB required)
run: build
	./$(BINARY)

## clean: remove build artifacts
clean:
	rm -f $(BINARY)
