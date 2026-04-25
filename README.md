# server-monitor

IT infrastructure monitoring platform — real-time server and network metrics.

## About

A full-stack monitoring dashboard built to track the health of servers, services and network devices across a municipal IT infrastructure. Displays real-time metrics, uptime history and alerts through a clean web interface.

## Stack

- **Back-end:** Python 3 · FastAPI
- **Front-end:** React · TypeScript
- **Database:** PostgreSQL
- **Containerization:** Docker · Docker Compose
- **Monitoring:** Custom agents · REST polling

## Features

- Real-time CPU, memory, disk and network metrics
- Service uptime tracking with alert thresholds
- Historical charts and trend analysis
- Multi-server dashboard
- REST API for metric ingestion from agents

## Getting Started

```bash
git clone https://github.com/at-n3tt0/server-monitor
cd server-monitor
cp .env.example .env
docker-compose up -d
```

## License

MIT
