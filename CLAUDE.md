# Le Tre Celle — app della pescheria

Sito installabile (PWA) pubblicato con GitHub Pages su https://letrecelle.github.io.
L'utente è italiano e lavora in pescheria: rispondigli in italiano semplice, senza termini tecnici.

## Come è fatto
- `sorgente/le-tre-celle.html` — l'app vera e propria (una sola pagina: HTML, CSS e JS). Parla con il database tramite `claude.use("db")`, come negli artifact di Claude.
- `sorgente/src/` — cosa aggiunge il sito: `head.html` (schermata di accesso, pezzo che fornisce `claude.use`), `ltc-firebase.js` (accesso Firebase + adattatore Firestore + download dei file), `sw.js` (funziona senza rete, si aggiorna da solo), manifest e icone.
- Database: Firebase progetto `le-tre-celle` (Firestore + accesso email/password, un solo account del negozio `letrecelle@gmail.com`). Le regole in `firestore.rules` sono una copia: quelle vere si cambiano dalla console Firebase.
- `tessdata/eng.wasm` — modello di lettura del testo per le foto di DDT e venduto (letto sul telefono con tesseract.js).

## Per fare una modifica
1. Modifica `sorgente/le-tre-celle.html` (o i file in `sorgente/src/`).
2. `python3 sorgente/build.py` — rigenera `index.html`, `sw.js` ecc. nella radice.
3. Commit e push su `main`: GitHub Pages pubblica in circa un minuto; i telefoni prendono la versione nuova alla riapertura.

## Regole da rispettare
- **Dati riservati fuori dal codice.** Il codice su GitHub è pubblico: non scriverci mai prezzi, quantità, DDT, venduto, nomi di fornitori o dell'azienda, clienti o esempi presi da documenti veri. Tutto questo sta solo nel database (visibile solo dopo l'accesso). Il listino PLU sta in `settings/listino` (`{date, count, savedAt, json}`, dove `json` = `{"ignore":[...],"items":[[plu,nome,prezzo,unità,[altri PLU],codice],...]}`) e si mette dalle Impostazioni con «Scegli il file del listino» (file `{app:"le-tre-celle-listino", date, ignore, items}`).
- Non modificare a mano `index.html` nella radice: viene riscritto dal build.
- **Tutto ciò che si cancella va prima nel Cestino** (`trash/`, funzione `toTrash`): sezione `pesi` (zone azzerate, casse, prodotti, giorni di DDT/venduto) o `ordinazioni` (prenotazioni, clienti). Dal Cestino si ripristina o si elimina per sempre con doppio tocco. Una nuova cancellazione deve seguire la stessa strada e avere il suo ripristino in `trashRestore`.
- Le cancellazioni e le modifiche delicate chiedono il **doppio tocco** (funzione `arm`).

## Prenotazioni
- `bookingDays/<data>`: orari del giorno (`open`, `close`, `slotMin`, `cap` = clienti per fascia) e occupazione: `taken.<HHMM>.<idPrenotazione> = istante` (0 = libero), `kg.<idProdotto>.<idPrenotazione> = kg` (entra nell'ordine al fornitore del giorno di consegna).
- Si scrive sempre una voce alla volta con `update` (merge), così più telefoni prenotano insieme. Se due prendono l'ultimo posto nello stesso momento, vince chi è arrivato prima (`istante`) e l'altro riceve l'avviso per spostarsi.
- `bookings/<id>` (cliente, giorno, fascia, prodotti, stato attesa/pronta/ritirata), `customers/<id>` (rubrica).
- I conteggi si salvano "a celle" (merge-write per prodotto e zona) così più telefoni possono contare insieme: non tornare a scrivere il documento intero.
