#!/usr/bin/env bash
# Delega allo script di avvio unificato nella cartella genitore
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$DIR/../start-dev.sh" ]; then
  exec "$DIR/../start-dev.sh" "$@"
else
  echo "Errore: start-dev.sh non trovato nella cartella genitore."
  echo "Assicurati di aver clonato cancellamy-backend e cancellamy-frontend affiancati nella stessa cartella."
  exit 1
fi
