# Terra Vida

Jeu de vie en monde ouvert **multijoueur**, jouable dans le navigateur (ordinateur et mobile) :
voyage dans **197 pays** via leurs aéroports, exerce un **métier**, conduis **45 véhicules**,
personnalise ton **skin**, fonde ta **famille** et deviens **⭐ Premium**.

## Lancer le jeu

```bash
npm install
npm start          # http://localhost:3000
npm test           # tests du serveur (économie, paiements, anti-triche, vols, familles)
PAYMENTS_SANDBOX=1 npm start   # avec une caisse de paiement simulée (développement)
```

Copie `.env.example` en `.env` (ou en variables d'environnement de ton hébergeur) pour la production.

Ouvre plusieurs onglets ou appareils sur la même adresse pour jouer à plusieurs.
Variables : `PORT` (défaut 3000), `DATA_FILE` (défaut `data/db.json`).

## Fonctionnalités

| Domaine | Contenu |
|---|---|
| Monde | Une ville + un aéroport générés pour chaque pays, 6 climats (tempéré, méditerranéen, désert, savane, tropical, neige), relief, mer, végétation, circulation, cycle jour/nuit partagé (1 jour = 24 min) |
| Graphismes | Three.js : ciel physique, ombres douces, tone mapping ACES, reflets, façades éclairées la nuit, lampadaires |
| Voyages | Comptoir de l'aéroport → billet (400 Ʋ régional, 1 100 Ʋ international) → cinématique de décollage → arrivée dans le pays |
| Métiers | Livreur, Chauffeur de taxi (voiture obligatoire), Ambulancier, Policier — missions enchaînées, payées par le serveur |
| Skins | Teint, cheveux, haut, pantalon, chapeau (couleurs libres) ; boutique de vêtements (casquette, cowboy, boubou, costume, couronne…) |
| Véhicules | 45 modèles de 11 marques fictives (Japon, Corée, Allemagne, France, Italie, R.-U., USA, Chine, Suède, Bénin, Norvège) : citadines, berlines, breaks, SUV, pick-up, sportives, supercars, minibus (gbaka), camion, bus, motos (zémidjan). Carrosserie profilée, vitrage, optiques, jantes à rayons, phares la nuit, boîte auto, frein à main/dérapage, roulis, son moteur synthétisé, compteur |
| Monnaies | **Cauris 🐚** (argent du jeu, gagné par les métiers) et **Vida Ʋ** (monnaie de l'application, achetée en argent réel) |
| Paiements | MTN MoMo, Moov Money, Celtiis Cash, Wave, Orange Money, PayPal/carte ; reçu numéroté imprimable pour chaque paiement, historique |
| Premium ⭐ | 3 mois : 1 000 FCFA (100 Ʋ) la 1re fois, 1 600 FCFA (160 Ʋ) ensuite ; badge doré, +50 % de salaire, −30 % sur les vols, véhicules exclusifs |
| Familles | Création, invitations, chat familial, virements entre membres, transmission du rôle de chef |
| Serveurs | 5 salons indépendants (40 joueurs max), chat, joueurs visibles seulement dans le même pays |

Commandes : ZQSD/WASD/flèches, souris pour la caméra, Maj courir, Espace sauter (frein à main en voiture),
**E** interagir, **V** véhicule, **B** klaxon, **M** son, **P** Vida/Premium, **C** garde-robe, **G** famille,
**H** aide, Entrée chat. Sur mobile : joystick + boutons.

## Paiements (Vida)

### Comment ça marche
1. Le joueur choisit un pack et un moyen de paiement dans **💎 Vida**.
2. Le serveur crée une commande et redirige vers la page sécurisée du prestataire.
3. Au retour (et via le webhook du prestataire), le serveur **revérifie le statut auprès de l'API du
   prestataire** avec sa clé secrète, contrôle que le montant correspond au pack, puis crédite les Vida
   **une seule fois** (protection contre les doubles crédits et les montants falsifiés).
4. Un **reçu numéroté** (`TV-2026-000001`) est généré, imprimable/PDF, consultable dans l'onglet *Reçus*.

Webhooks à déclarer chez chaque prestataire : `PUBLIC_URL/pay/webhook/fedapay`, `/pay/webhook/wave`,
`/pay/webhook/cinetpay`, `/pay/webhook/paypal`.

### Quel prestataire pour quel moyen ? (meilleurs tarifs constatés, nov. 2026)
Le serveur choisit automatiquement le prestataire actif **le moins cher** pour chaque moyen (`ROUTING`
dans `server/payments/providers.js`).

| Moyen | Prestataire recommandé | Commission publique | Remarque |
|---|---|---|---|
| MTN MoMo, Moov Money, Celtiis Cash (Bénin) | **FedaPay** | ~1,8 %, sans abonnement | seul à couvrir clairement Celtiis Cash |
| Wave | **Wave Checkout** (direct) | ~1 % | moins cher que via un agrégateur (~2,5 %) ; Sénégal/Côte d'Ivoire |
| Orange Money (+ secours MTN/Moov/Wave) | **CinetPay** | ~1,5 à 3,5 % selon pays | multi-pays d'Afrique de l'Ouest et centrale |
| PayPal / carte | **PayPal** | ~3,4 à 5,4 % + frais fixe | ⚠️ un compte PayPal **béninois** ne peut en principe pas recevoir de paiements : il faut une entité dans un pays éligible |

Ces taux viennent des grilles publiques et de comparatifs ; ils changent souvent et se négocient selon le
volume. **Demande un devis écrit** à chaque prestataire avant de fixer les prix. KKiaPay (Bénin) est une
alternative à FedaPay (1 à 1,5 % annoncés) mais son intégration se fait par widget ; elle n'est pas
branchée ici.

### À faire avant d'encaisser de l'argent réel
- Créer les comptes marchands (KYC : pièce d'identité, RCCM/IFU pour une entreprise au Bénin).
- Tester chaque prestataire en mode *sandbox*, puis passer en `live`.
- Publier des **CGV** (prix TTC, livraison immédiate des Vida, politique de remboursement), des mentions
  légales et une politique de confidentialité ; renseigner `MERCHANT_*` pour les reçus.
- **Mineurs** : prévoir l'accord parental pour les achats.
- Fiscalité : vérifier TVA et déclaration des ventes de biens numériques avec un comptable.
- Héberger en **HTTPS** (obligatoire pour les retours de paiement).

## Architecture

```
server/   index.js (HTTP + WebSocket + routes /pay et /receipt) · game.js (règles) · store.js (persistance)
server/payments/   providers.js (FedaPay, Wave, CinetPay, PayPal, simulation) · service.js (commandes) · pages.js (reçus)
shared/   countries.js · layout.js (carte déterministe) · catalog.js (économie) · vehicles.js (catalogue)
public/   index.html · css/ · js/ (main, world, character, vehicles, driving, audio, ui, net)
```

- **Le serveur fait autorité** sur l'argent, les achats, les missions, les vols et les familles ;
  le client ne fait que demander. Validations : distance au lieu, durée minimale de mission,
  vitesse maximale (anti-téléportation), objets possédés, limitation de débit, textes nettoyés.
- `shared/layout.js` est exécuté **à l'identique** côté client et serveur : même carte sans transfert de données.
- Comptes sans mot de passe : un jeton aléatoire stocké dans le navigateur (haché côté serveur).
  ⚠️ Avec de l'argent réel en jeu, ajoute une vraie connexion (téléphone + code SMS, ou e-mail) pour que
  les joueurs ne perdent pas leurs Vida en changeant de navigateur.
- Marques de véhicules **fictives** : utiliser de vraies marques (noms, logos, formes) exige une licence.

## Limites actuelles / suite

- Persistance en fichier JSON → passer à PostgreSQL/Redis au-delà de quelques centaines de joueurs.
- Un seul processus Node : pour beaucoup de joueurs, un processus par salon derrière un répartiteur.
- Véhicules et personnages procéduraux : pour un rendu photo-réaliste, importer des modèles glTF
  (achetés ou sous licence CC0) — le code de conduite et le catalogue restent les mêmes.
- Pistes : maisons à acheter, banque/salaire, PNJ piétons, voix, comptes avec mot de passe/OAuth, modération du chat.
