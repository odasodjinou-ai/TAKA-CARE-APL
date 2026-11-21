# Terra Vida

Jeu de vie en monde ouvert **multijoueur**, jouable dans le navigateur (ordinateur et mobile) :
voyage dans **197 pays** via leurs aéroports, exerce un **métier**, gagne des **Vidas (Ʋ)**,
personnalise ton **skin**, achète des **voitures** et fonde ta **famille**.

## Lancer le jeu

```bash
npm install
npm start          # http://localhost:3000
npm test           # tests du serveur (économie, anti-triche, vols, familles)
```

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
| Véhicules | Citadine (offerte), Pick-up, SUV, Sportive ; couleur au choix |
| Familles | Création, invitations, chat familial, virements entre membres, transmission du rôle de chef |
| Serveurs | 5 salons indépendants (40 joueurs max), chat, joueurs visibles seulement dans le même pays |

Commandes : ZQSD/WASD/flèches, souris pour la caméra, Maj courir, Espace sauter, **E** interagir,
**V** voiture, **C** garde-robe, **G** famille, **H** aide, Entrée chat. Sur mobile : joystick + boutons.

## Architecture

```
server/   index.js (HTTP statique + WebSocket) · game.js (règles, autorité) · store.js (persistance JSON)
shared/   countries.js · layout.js (génération déterministe de la carte) · catalog.js (économie)
public/   index.html · css/ · js/ (main, world, character, vehicles, ui, net)
```

- **Le serveur fait autorité** sur l'argent, les achats, les missions, les vols et les familles ;
  le client ne fait que demander. Validations : distance au lieu, durée minimale de mission,
  vitesse maximale (anti-téléportation), objets possédés, limitation de débit, textes nettoyés.
- `shared/layout.js` est exécuté **à l'identique** côté client et serveur : même carte sans transfert de données.
- Comptes sans mot de passe : un jeton aléatoire stocké dans le navigateur (haché côté serveur).

## Limites actuelles / suite

- Persistance en fichier JSON → passer à PostgreSQL/Redis au-delà de quelques centaines de joueurs.
- Un seul processus Node : pour beaucoup de joueurs, un processus par salon derrière un répartiteur.
- Modèles 3D procéduraux (pas d'assets) : intégrer des modèles glTF (personnages animés, voitures) pour un rendu plus réaliste.
- Pistes : maisons à acheter, banque/salaire, PNJ piétons, voix, comptes avec mot de passe/OAuth, modération du chat.
