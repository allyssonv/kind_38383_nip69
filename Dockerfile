# Usar a imagem base node:22.18.0-alpine
FROM node:22.18.0-alpine

# Adicionar metadados com labels
LABEL maintainer="LibertGuy <LibertGuy@proton.me>"
LABEL version="1.0"
LABEL description="Dockerfile para rodar uma aplicação Node.js a cada 5 minutos com cron"

# Definir variáveis de ambiente
ENV APP_DIR=/app
ENV CRON_LOG=${APP_DIR}/cron.log
ENV MAIN_SCRIPT=index.js
ENV TERM xterm-256color

# Definir diretório de trabalho
WORKDIR ${APP_DIR}

# Copiar apenas package.json e package-lock.json (se existir) para aproveitar cache
COPY package*.json ./

# Instalar dependências e ferramentas necessárias, criar diretórios e configurar logs
RUN apk add --no-cache tini busybox && \
    npm install --omit=dev && \
    mkdir -p ${APP_DIR}/logs && \
    touch ${CRON_LOG}

# Copiar o restante do código da aplicação
COPY . .

# Verificar se o arquivo principal existe e configurar o cron com caminho absoluto
RUN if [ ! -f "${APP_DIR}/${MAIN_SCRIPT}" ]; then \
        echo "Erro: Arquivo ${MAIN_SCRIPT} não encontrado no diretório ${APP_DIR}"; \
        exit 1; \
    fi && \
    echo "*/5 * * * * cd ${APP_DIR} && node ${MAIN_SCRIPT} >> ${CRON_LOG} 2>&1" > /etc/crontabs/root

# Usar tini como entrypoint para gerenciar processos
ENTRYPOINT ["/sbin/tini", "--"]

# Iniciar o cron em foreground
CMD ["crond", "-f", "-l", "8"]