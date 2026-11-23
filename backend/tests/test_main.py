from fastapi.testclient import TestClient
from app.main import app


def test_auth_and_snapshot_round_trip(tmp_path, monkeypatch):
    monkeypatch.setenv('DATABASE_PATH', str(tmp_path / 'db.sqlite3'))
    monkeypatch.setenv('API_KEY', 'test-secret')
    client = TestClient(app)
    assert client.get('/healthz').json() == {'status': 'ok'}
    assert client.get('/v1/snapshot').status_code == 401
    headers = {'X-API-Key': 'test-secret'}
    fetched = client.get('/v1/snapshot', headers=headers)
    assert fetched.status_code == 200
    assert fetched.headers['etag'] == '"0"'
    data = fetched.json()
    data['decks'].append({'id': 'deck-1', 'name': 'Math', 'updatedAt': '2026-01-01T00:00:00Z'})
    missing_revision = client.put('/v1/snapshot', json=data, headers=headers)
    assert missing_revision.status_code == 428
    saved = client.put('/v1/snapshot', json=data, headers={**headers, 'If-Match': '"0"'})
    assert saved.status_code == 200
    assert saved.headers['etag'] == '"1"'
    assert client.get('/v1/snapshot', headers=headers).json()['decks'][0]['name'] == 'Math'
    conflict = client.put('/v1/snapshot', json=data, headers={**headers, 'If-Match': '"0"'})
    assert conflict.status_code == 409
    assert client.get('/v1/summary', headers=headers).json()['decks'] == 1


def test_no_default_api_key(tmp_path, monkeypatch):
    monkeypatch.setenv('DATABASE_PATH', str(tmp_path / 'db.sqlite3'))
    monkeypatch.delenv('API_KEY', raising=False)
    assert TestClient(app).get('/v1/snapshot').status_code == 503
