package internal

import (
	crand "crypto/rand"
	"math/big"
	"strings"
)

func randInt(min, max int) int {
	value, err := crand.Int(crand.Reader, big.NewInt(int64(max-min+1)))
	if err != nil {
		panic("Secure randomness is unavailable")
	}
	return int(value.Int64()) + min
}

func randString(charset string, minLen, maxLen int) string {
	length := randInt(minLen, maxLen)
	bytes := make([]byte, length)
	for i := range bytes {
		bytes[i] = charset[randInt(0, len(charset)-1)]
	}

	return string(bytes)
}

func randSubdomain() (string, error) {
	const charset = "abcdefghijklmnopqrstuvwxyz0123456789-"
	for {
		subdomain := randString(charset, 16, 32)
		if !strings.HasPrefix(subdomain, "-") && !strings.HasSuffix(subdomain, "-") {
			return subdomain, nil
		}
	}
}
