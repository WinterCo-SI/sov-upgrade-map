package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"
)

func main() {
	mainBackend := os.Getenv("MAIN_BACKEND_URL")
	if mainBackend == "" {
		mainBackend = "https://scit.scers.cn:45161"
	}
	pluginKeyHex := os.Getenv("PLUGIN_KEY")
	if pluginKeyHex == "" {
		log.Fatal("PLUGIN_KEY is required")
	}
	pluginKey, err := hex.DecodeString(pluginKeyHex)
	if err != nil {
		log.Fatalf("PLUGIN_KEY is not valid hex: %v", err)
	}
	listenAddr := os.Getenv("LISTEN_ADDR")
	if listenAddr == "" {
		listenAddr = ":8080"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/", apiHandler(mainBackend, pluginKey))

	log.Printf("starting sov-upgrade-map proxy on %s", listenAddr)
	log.Printf("backend: %s", mainBackend)
	if err := http.ListenAndServe(listenAddr, mux); err != nil {
		log.Fatal(err)
	}
}

// timestamp.hmac-sha256(key, timestamp)
func authToken(key []byte) string {
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(ts))
	return ts + "." + hex.EncodeToString(mac.Sum(nil))
}

func apiHandler(backend string, key []byte) http.HandlerFunc {
	authRoutes := map[string]bool{
		"/api/public/sovereignty/status":    true,
		"/api/public/sovereignty/ownership": true,
	}

	return func(w http.ResponseWriter, r *http.Request) {
		target := backend + r.URL.Path
		if r.URL.RawQuery != "" {
			target += "?" + r.URL.RawQuery
		}

		req, err := http.NewRequestWithContext(r.Context(), r.Method, target, r.Body)
		if err != nil {
			http.Error(w, "bad request", http.StatusInternalServerError)
			return
		}
		req.Header = r.Header.Clone()

		if authRoutes[r.URL.Path] {
			token := authToken(key)
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("X-Sovereignty-Token", token)
		}

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			http.Error(w, "proxy error: "+err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		for k, vv := range resp.Header {
			for _, v := range vv {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
	}
}
