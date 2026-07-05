#!/usr/bin/env bash
# 윷놀이(/yutnori) + 전략윷놀이(/strategy-yutnori)를 WAS(58.228.188.17)에 반영하는 스크립트.
# 반드시 run-hoban-run 저장소 루트에서, WSL2(SSH 키가 있고 WAS에 도달 가능한 로컬 머신)에서 실행할 것.
# (Claude Code 백그라운드 잡 환경에서는 WAS의 30080/10022가 도달 불가라 실행 불가 — 로컬에서 실행.)
# 자세한 배경/구조는 ws-server/README.md의 "재배포 절차" 참고.
# deploy-halligalli-was.sh와 동일 패턴. 컨테이너 교체 순간 전 게임 WS가 수 초 끊긴다.
set -Eeuo pipefail

SSH_KEY="/home/msyeo/.ssh/id_ed25519"
SSH="ssh -p 10022 -i $SSH_KEY -o IdentitiesOnly=yes -o BatchMode=yes msyeo@58.228.188.17"

echo "== 1. 최신 master 받기 =="
if [[ -n "$(git status --porcelain)" ]]; then
  echo "커밋되지 않은 변경사항이 있어 중단합니다. 먼저 커밋/스태시하세요." >&2
  exit 1
fi
git fetch origin master
git checkout master
git pull origin master

echo "== 2. WAS로 ws-server 소스 동기화 (yutnori*.mjs / strategy-yutnori*.mjs 포함) =="
rsync -av -e "ssh -p 10022 -i $SSH_KEY -o IdentitiesOnly=yes -o BatchMode=yes" \
  --exclude node_modules --exclude data \
  ws-server/ msyeo@58.228.188.17:~/run-hoban-run-ws-server/

echo "== 3. 이미지 재빌드 =="
$SSH 'cd ~/run-hoban-run-ws-server && docker build -t run-hoban-run-rps-server:latest .'

echo "== 4. 컨테이너 교체 (named volume 재사용 - 랭킹 데이터 보존) =="
$SSH 'docker rm -f rps-server 2>/dev/null; docker run -d --name rps-server --restart unless-stopped \
  -p 30081:8787 -v rps-server-data:/app/data run-hoban-run-rps-server:latest'

echo "== 5. WAS의 nginx.conf(저장소 사본과 별개!)에 /yutnori · /strategy-yutnori location 추가 =="
# 각각 idempotent: 이미 있으면 건너뛴다. /mafia 블록 앞에 삽입(검증된 위치).
$SSH 'grep -q "location /yutnori " ~/rps-tls/nginx.conf || grep -q "location /yutnori$" ~/rps-tls/nginx.conf || \
  sed -i "/location \/mafia {/i\\
    location /yutnori {\\
        proxy_pass http://127.0.0.1:30081/yutnori;\\
        proxy_http_version 1.1;\\
        proxy_set_header Upgrade \$http_upgrade;\\
        proxy_set_header Connection \"upgrade\";\\
        proxy_set_header Host \$host;\\
        proxy_read_timeout 3600s;\\
    }\\
" ~/rps-tls/nginx.conf'
$SSH 'grep -q "location /strategy-yutnori" ~/rps-tls/nginx.conf || \
  sed -i "/location \/mafia {/i\\
    location /strategy-yutnori {\\
        proxy_pass http://127.0.0.1:30081/strategy-yutnori;\\
        proxy_http_version 1.1;\\
        proxy_set_header Upgrade \$http_upgrade;\\
        proxy_set_header Connection \"upgrade\";\\
        proxy_set_header Host \$host;\\
        proxy_read_timeout 3600s;\\
    }\\
" ~/rps-tls/nginx.conf'
echo "-- nginx 설정 문법 검사 후 재적용 --"
$SSH 'docker exec rps-tls nginx -t && docker restart rps-tls'

echo "== 6. 확인 =="
$SSH 'curl -s http://localhost:30081/healthz; echo'
echo "-- 외부 확인 --"
curl -sk https://toris-arcade.duckdns.org:30080/healthz; echo

echo "== 완료: 아래로 실제 WS 접속 확인해볼 것 =="
echo "   wss://toris-arcade.duckdns.org:30080/yutnori"
echo "   wss://toris-arcade.duckdns.org:30080/strategy-yutnori"
