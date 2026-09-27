package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"

	"archeagent/executor/internal/sandbox"
)

type server struct {
	runner sandbox.Runner
}

func (s server) health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok","service":"archeagent-executor"}`))
}

func (s server) execute(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256*1024))
	decoder.DisallowUnknownFields()

	var spec sandbox.Spec
	if err := decoder.Decode(&spec); err != nil {
		http.Error(w, "invalid execution spec", http.StatusBadRequest)
		return
	}

	if err := spec.Validate(); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	result, err := s.runner.Run(context.Background(), spec)
	if err != nil && !result.TimedOut {
		http.Error(w, "execution failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if result.TimedOut {
		w.WriteHeader(http.StatusRequestTimeout)
	}
	_ = json.NewEncoder(w).Encode(result)
}

func main() {
	addr := os.Getenv("ARCHEAGENT_EXECUTOR_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8788"
	}

	s := server{runner: sandbox.DockerRunner{}}
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.health)
	mux.HandleFunc("/v1/execute", s.execute)

	log.Printf("archeagent executor listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}
