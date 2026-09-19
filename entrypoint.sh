#!/bin/bash
set -e

echo "Starting SynapseDB TCP Engine..."
/usr/local/bin/synapsedb &

sleep 1

echo "Starting SynapseDB REST Gateway on port ${PORT:-7860}..."
python3 /app/gateway.py
