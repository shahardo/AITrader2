# Dockerfile — backend image used by the api, worker, and beat services
# (the compose file overrides the command for worker/beat).

FROM python:3.12-slim

WORKDIR /srv/backend
COPY pyproject.toml ./
RUN pip install --no-cache-dir . && pip install --no-cache-dir "pydantic[email]" lxml
COPY . .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
