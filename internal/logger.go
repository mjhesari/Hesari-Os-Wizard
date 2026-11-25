package internal

import (
	"errors"
	"fmt"
	"os"

	"github.com/cloudflare/cloudflare-go/v7"
)

type Logger struct {
	color bool
}

func NewLogger() *Logger {
	return &Logger{color: true}
}

func (l *Logger) Info(msg string) {
	fmt.Printf("%s %s\n", FmtStr("•", ColorBlue, true), msg)
}

func (l *Logger) Success(msg string) {

	fmt.Printf("%s %s\n", FmtStr("✓", ColorGreen, true), msg)
}

func (l *Logger) Error(msg string) {
	fmt.Printf("%s %s\n", FmtStr("✗", ColorRed, true), msg)
}

func (l *Logger) Fatal(err error) {
	msg := fmt.Sprintf("Failed to install HESARI OS: %s", safeInstallationError(err))
	l.Error(msg)
	os.Exit(1)
}

func safeInstallationError(err error) string {
	var apiErr *cloudflare.Error
	if errors.As(err, &apiErr) {
		return fmt.Sprintf("Cloudflare request failed (HTTP %d).", apiErr.StatusCode)
	}
	return err.Error()
}
