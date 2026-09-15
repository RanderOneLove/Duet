# Ретранслятор совместного прослушивания

Крошечный сервер без зависимостей: принимает от ведущего «какой трек и с какой
секунды» и раздаёт это ведомым. Аудио через него не идёт — каждый слушает из
своего аккаунта, поэтому и передавать нечего, кроме названия трека и позиции.

Хранилища нет: всё живёт в памяти и исчезает вместе с сессией.

## Что нужно

Node 18 или новее. Больше ничего — ни npm install, ни базы.

## Установка на VPS

Положить файл и завести службу:

```bash
sudo mkdir -p /opt/duet-relay
sudo cp relay.mjs /opt/duet-relay/
sudo useradd --system --no-create-home duet || true
```

`/etc/systemd/system/duet-relay.service`:

```ini
[Unit]
Description=Duet listen-together relay
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/duet-relay/relay.mjs
Environment=PORT=8787
Environment=HOST=127.0.0.1
User=duet
Restart=always
RestartSec=3
# Сервер ничего не пишет на диск, так что доступ ему не нужен.
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now duet-relay
curl -s localhost:8787/healthz
```

## nginx

Сервер намеренно слушает только `127.0.0.1` — наружу его выпускает nginx,
он же даёт TLS. В блок для `rander.pro`:

```nginx
location /duet/ {
    proxy_pass http://127.0.0.1:8787/;
    proxy_http_version 1.1;

    # Поток событий: без этих трёх строк nginx копит ответ в буфере и
    # обрывает «молчащее» соединение — ведомый переставал получать обновления.
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;

    proxy_set_header Connection '';
    proxy_set_header Host $host;
}
```

Проверка снаружи:

```bash
curl -s https://rander.pro/duet/healthz
# {"ok":true,"sessions":0}
```

## Как это выглядит со стороны приложения

| Запрос | Кто | Зачем |
|---|---|---|
| `POST /duet/s/<код>` + `X-Duet-Key` | ведущий | опубликовать, что играет |
| `GET /duet/s/<код>` | ведомый | держать поток и получать обновления |

Код приглашения придумывает приложение ведущего, оно же придумывает ключ.
Код уходит в ссылку и потому считается известным всем, кому её показали;
**ключ не уходит никуда** — он и отличает ведущего от того, кто просто
подсмотрел ссылку. Первая публикация закрепляет ключ за кодом, дальше чужая
публикация получает отказ.

Сессия без вестей от ведущего пять минут считается брошенной: ведомым уходит
событие `ended`, и сессия удаляется.
