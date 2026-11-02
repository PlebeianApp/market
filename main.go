package main

import (
	"fmt"
	"os"

	"github.com/maximotodev/plebeian-auctions-poc/internal/poc"
)

func main() {
	if err := poc.RunCLI(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "plebeian-auctions-poc:", err)
		os.Exit(1)
	}
}
