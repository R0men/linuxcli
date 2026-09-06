FROM alpine:3.20

RUN apk add --no-cache \
    bind-tools \
    whois \
    curl \
    openssl \
    mtr \
    iputils \
    netcat-openbsd \
  && addgroup -g 10001 sandbox \
  && adduser -D -H -u 10001 -G sandbox sandbox

USER sandbox

# Долгоживущий no-op — контейнер стоит в pre-warmed пуле (Orchestrator,
# задача 4) до момента, пока в него не сделают один exec с whitelisted
# бинарником; после — контейнер уничтожается целиком, не переиспользуется.
CMD ["sleep", "2147483647"]
