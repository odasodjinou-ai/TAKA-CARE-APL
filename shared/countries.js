// Liste des pays jouables. Chaque pays possède un aéroport international généré
// procéduralement. Format compact : CODE|Nom|Région|Biome
// Régions : AF Afrique, EU Europe, ME Moyen-Orient, AS Asie, NA Amérique du Nord & Caraïbes,
//           SA Amérique du Sud, OC Océanie
// Biomes  : temperate, mediterranean, desert, savanna, tropical, snow

const RAW = `
DZ|Algérie|AF|desert
AO|Angola|AF|tropical
BJ|Bénin|AF|tropical
BW|Botswana|AF|savanna
BF|Burkina Faso|AF|savanna
BI|Burundi|AF|tropical
CV|Cap-Vert|AF|mediterranean
CM|Cameroun|AF|tropical
CF|Centrafrique|AF|tropical
TD|Tchad|AF|desert
KM|Comores|AF|tropical
CG|Congo|AF|tropical
CD|RD Congo|AF|tropical
CI|Côte d'Ivoire|AF|tropical
DJ|Djibouti|AF|desert
EG|Égypte|AF|desert
GQ|Guinée équatoriale|AF|tropical
ER|Érythrée|AF|desert
SZ|Eswatini|AF|savanna
ET|Éthiopie|AF|savanna
GA|Gabon|AF|tropical
GM|Gambie|AF|tropical
GH|Ghana|AF|tropical
GN|Guinée|AF|tropical
GW|Guinée-Bissau|AF|tropical
KE|Kenya|AF|savanna
LS|Lesotho|AF|temperate
LR|Liberia|AF|tropical
LY|Libye|AF|desert
MG|Madagascar|AF|tropical
MW|Malawi|AF|savanna
ML|Mali|AF|desert
MR|Mauritanie|AF|desert
MU|Maurice|AF|tropical
MA|Maroc|AF|mediterranean
MZ|Mozambique|AF|tropical
NA|Namibie|AF|desert
NE|Niger|AF|desert
NG|Nigeria|AF|tropical
RW|Rwanda|AF|tropical
ST|Sao Tomé-et-Principe|AF|tropical
SN|Sénégal|AF|savanna
SC|Seychelles|AF|tropical
SL|Sierra Leone|AF|tropical
SO|Somalie|AF|desert
ZA|Afrique du Sud|AF|mediterranean
SS|Soudan du Sud|AF|savanna
SD|Soudan|AF|desert
TZ|Tanzanie|AF|savanna
TG|Togo|AF|tropical
TN|Tunisie|AF|mediterranean
UG|Ouganda|AF|tropical
ZM|Zambie|AF|savanna
ZW|Zimbabwe|AF|savanna
AL|Albanie|EU|mediterranean
AD|Andorre|EU|temperate
AT|Autriche|EU|temperate
BY|Biélorussie|EU|temperate
BE|Belgique|EU|temperate
BA|Bosnie-Herzégovine|EU|temperate
BG|Bulgarie|EU|temperate
HR|Croatie|EU|mediterranean
CY|Chypre|EU|mediterranean
CZ|Tchéquie|EU|temperate
DK|Danemark|EU|temperate
EE|Estonie|EU|temperate
FI|Finlande|EU|snow
FR|France|EU|temperate
DE|Allemagne|EU|temperate
GR|Grèce|EU|mediterranean
HU|Hongrie|EU|temperate
IS|Islande|EU|snow
IE|Irlande|EU|temperate
IT|Italie|EU|mediterranean
XK|Kosovo|EU|temperate
LV|Lettonie|EU|temperate
LI|Liechtenstein|EU|temperate
LT|Lituanie|EU|temperate
LU|Luxembourg|EU|temperate
MT|Malte|EU|mediterranean
MD|Moldavie|EU|temperate
MC|Monaco|EU|mediterranean
ME|Monténégro|EU|mediterranean
NL|Pays-Bas|EU|temperate
MK|Macédoine du Nord|EU|temperate
NO|Norvège|EU|snow
PL|Pologne|EU|temperate
PT|Portugal|EU|mediterranean
RO|Roumanie|EU|temperate
RU|Russie|EU|snow
SM|Saint-Marin|EU|mediterranean
RS|Serbie|EU|temperate
SK|Slovaquie|EU|temperate
SI|Slovénie|EU|temperate
ES|Espagne|EU|mediterranean
SE|Suède|EU|snow
CH|Suisse|EU|temperate
UA|Ukraine|EU|temperate
GB|Royaume-Uni|EU|temperate
VA|Vatican|EU|mediterranean
AE|Émirats arabes unis|ME|desert
BH|Bahreïn|ME|desert
IL|Israël|ME|mediterranean
IQ|Irak|ME|desert
IR|Iran|ME|desert
JO|Jordanie|ME|desert
KW|Koweït|ME|desert
LB|Liban|ME|mediterranean
OM|Oman|ME|desert
PS|Palestine|ME|mediterranean
QA|Qatar|ME|desert
SA|Arabie saoudite|ME|desert
SY|Syrie|ME|desert
TR|Turquie|ME|mediterranean
YE|Yémen|ME|desert
AF|Afghanistan|AS|desert
AM|Arménie|AS|temperate
AZ|Azerbaïdjan|AS|temperate
BD|Bangladesh|AS|tropical
BT|Bhoutan|AS|temperate
BN|Brunei|AS|tropical
KH|Cambodge|AS|tropical
CN|Chine|AS|temperate
GE|Géorgie|AS|temperate
IN|Inde|AS|tropical
ID|Indonésie|AS|tropical
JP|Japon|AS|temperate
KZ|Kazakhstan|AS|savanna
KP|Corée du Nord|AS|temperate
KR|Corée du Sud|AS|temperate
KG|Kirghizistan|AS|snow
LA|Laos|AS|tropical
MY|Malaisie|AS|tropical
MV|Maldives|AS|tropical
MN|Mongolie|AS|savanna
MM|Myanmar|AS|tropical
NP|Népal|AS|snow
PK|Pakistan|AS|desert
PH|Philippines|AS|tropical
SG|Singapour|AS|tropical
LK|Sri Lanka|AS|tropical
TW|Taïwan|AS|tropical
TJ|Tadjikistan|AS|snow
TH|Thaïlande|AS|tropical
TL|Timor oriental|AS|tropical
TM|Turkménistan|AS|desert
UZ|Ouzbékistan|AS|desert
VN|Viêt Nam|AS|tropical
AG|Antigua-et-Barbuda|NA|tropical
BS|Bahamas|NA|tropical
BB|Barbade|NA|tropical
BZ|Belize|NA|tropical
CA|Canada|NA|snow
CR|Costa Rica|NA|tropical
CU|Cuba|NA|tropical
DM|Dominique|NA|tropical
DO|République dominicaine|NA|tropical
SV|Salvador|NA|tropical
GD|Grenade|NA|tropical
GT|Guatemala|NA|tropical
HT|Haïti|NA|tropical
HN|Honduras|NA|tropical
JM|Jamaïque|NA|tropical
MX|Mexique|NA|desert
NI|Nicaragua|NA|tropical
PA|Panama|NA|tropical
KN|Saint-Kitts-et-Nevis|NA|tropical
LC|Sainte-Lucie|NA|tropical
VC|Saint-Vincent-et-les-Grenadines|NA|tropical
TT|Trinité-et-Tobago|NA|tropical
US|États-Unis|NA|desert
AR|Argentine|SA|temperate
BO|Bolivie|SA|savanna
BR|Brésil|SA|tropical
CL|Chili|SA|mediterranean
CO|Colombie|SA|tropical
EC|Équateur|SA|tropical
GY|Guyana|SA|tropical
PY|Paraguay|SA|savanna
PE|Pérou|SA|desert
SR|Suriname|SA|tropical
UY|Uruguay|SA|temperate
VE|Venezuela|SA|tropical
AU|Australie|OC|desert
FJ|Fidji|OC|tropical
KI|Kiribati|OC|tropical
MH|Îles Marshall|OC|tropical
FM|Micronésie|OC|tropical
NR|Nauru|OC|tropical
NZ|Nouvelle-Zélande|OC|temperate
PW|Palaos|OC|tropical
PG|Papouasie-Nouvelle-Guinée|OC|tropical
WS|Samoa|OC|tropical
SB|Îles Salomon|OC|tropical
TO|Tonga|OC|tropical
TV|Tuvalu|OC|tropical
VU|Vanuatu|OC|tropical
`;

export const REGIONS = {
  AF: 'Afrique',
  EU: 'Europe',
  ME: 'Moyen-Orient',
  AS: 'Asie',
  NA: 'Amérique du Nord & Caraïbes',
  SA: 'Amérique du Sud',
  OC: 'Océanie',
};

/** Drapeau emoji à partir du code ISO (indicateurs régionaux Unicode). */
export function flagOf(code) {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export const COUNTRIES = Object.freeze(
  RAW.trim()
    .split('\n')
    .map((line) => {
      const [code, name, region, biome] = line.split('|');
      return Object.freeze({ code, name, region, biome, flag: flagOf(code), airport: `Aéroport international — ${name}` });
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
);

export const COUNTRY_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export function isCountry(code) {
  return typeof code === 'string' && COUNTRY_BY_CODE.has(code);
}
