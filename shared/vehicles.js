// Catalogue des véhicules. Les marques sont FICTIVES : utiliser de vraies marques
// (noms, logos, designs) exige des licences des constructeurs.
// Chaque marque s'inspire du style automobile d'une région du monde.

export const BRANDS = {
  sakura: { name: 'Sakura Motors', origin: 'Japon', flag: '🇯🇵' },
  hanbit: { name: 'Hanbit', origin: 'Corée du Sud', flag: '🇰🇷' },
  vierland: { name: 'Vierland', origin: 'Allemagne', flag: '🇩🇪' },
  lumiere: { name: 'Lumière', origin: 'France', flag: '🇫🇷' },
  rossa: { name: 'Rossa Corse', origin: 'Italie', flag: '🇮🇹' },
  thornbury: { name: 'Thornbury', origin: 'Royaume-Uni', flag: '🇬🇧' },
  liberty: { name: 'Liberty Motor Co.', origin: 'États-Unis', flag: '🇺🇸' },
  dragonfly: { name: 'Dragonfly', origin: 'Chine', flag: '🇨🇳' },
  nordvik: { name: 'Nordvik', origin: 'Suède', flag: '🇸🇪' },
  savane: { name: 'Savane Auto', origin: 'Bénin', flag: '🇧🇯' },
  aurora: { name: 'Aurora EV', origin: 'Norvège', flag: '🇳🇴' },
};

export const CATEGORIES = {
  hatch: 'Citadines',
  sedan: 'Berlines',
  wagon: 'Breaks',
  suv: 'SUV & 4x4',
  pickup: 'Pick-up',
  coupe: 'Sportives',
  super: 'Supercars',
  van: 'Utilitaires & minibus',
  truck: 'Camions',
  bus: 'Bus',
  moto: 'Motos',
};

// id | marque | modèle | carrosserie | prix | monnaie (c = Cauris, v = Vida) | km/h max | 0-100 km/h (s) | options
// options : e = électrique, p = réservé Premium, t = taxi, l = luxe
const RAW = `
sakura-kora|sakura|Kora|hatch|0|c|150|13|
savane-dan|savane|Dan|hatch|3000|c|145|14|
lumiere-petit|lumiere|Petit|hatch|3500|c|160|12|
hanbit-mio|hanbit|Mio|hatch|4200|c|165|11|
dragonfly-bee|dragonfly|Bee EV|hatch|5200|c|150|9|e
savane-taxi|savane|Taxi Ville|hatch|6000|c|150|13|t
sakura-corsa|sakura|Corsa|sedan|9000|c|190|10|
hanbit-sonar|hanbit|Sonar|sedan|10500|c|200|9|
lumiere-etoile|lumiere|Étoile|sedan|12000|c|205|9|
liberty-monarch|liberty|Monarch|sedan|14000|c|210|8|
vierland-s5|vierland|S5|sedan|16000|c|240|6.5|l
dragonfly-han|dragonfly|Han EV|sedan|18000|c|230|4.5|e
thornbury-regent|thornbury|Regent|sedan|160|v|250|5.5|l
lumiere-evasion|lumiere|Évasion|wagon|11000|c|200|10|
nordvik-v7|nordvik|V7 Break|wagon|15000|c|220|7.5|
dragonfly-mountain|dragonfly|Mountain|suv|17000|c|185|9|
hanbit-tusk|hanbit|Tusk|suv|19000|c|190|8.5|
sakura-terra|sakura|Terra 4x4|suv|20000|c|175|10|
liberty-ranger|liberty|Ranger|suv|24000|c|200|7.5|
nordvik-xc|nordvik|XC|suv|26000|c|210|7|
vierland-x7|vierland|X7|suv|32000|c|245|5.5|l
aurora-nord|aurora|Nord EV|suv|38000|c|220|4.2|e
thornbury-highland|thornbury|Highland|suv|180|v|250|5.2|l
dragonfly-cargo|dragonfly|Cargo|pickup|9500|c|160|12|
savane-baobab|savane|Baobab 4x4|pickup|12000|c|165|11|
sakura-hauler|sakura|Hauler|pickup|14000|c|175|10|
liberty-workhorse|liberty|Workhorse|pickup|18000|c|190|7|
hanbit-strike|hanbit|Strike|coupe|28000|c|250|5.8|
sakura-zeta|sakura|Zeta|coupe|30000|c|260|5.2|
liberty-thunder|liberty|Thunder V8|coupe|34000|c|270|4.6|
vierland-gt|vierland|GT|coupe|42000|c|290|4.1|l
rossa-vento|rossa|Vento|coupe|120|v|300|3.8|l
vierland-apex|vierland|Apex|super|300|v|320|3.3|l
rossa-fulmine|rossa|Fulmine|super|350|v|330|3.0|l
rossa-tempesta|rossa|Tempesta|super|500|v|350|2.8|lp
aurora-volt|aurora|Volt S|super|600|v|360|2.2|elp
lumiere-cargo|lumiere|Cargo|van|8000|c|150|14|
savane-gbaka|savane|Gbaka|van|11000|c|130|16|
sakura-shuttle|sakura|Shuttle|van|13000|c|160|13|
liberty-box|liberty|Box Truck|truck|22000|c|120|18|
savane-bus|savane|Bus Urbain|bus|35000|c|100|22|
savane-zem|savane|Zém 125|moto|1500|c|105|9|
dragonfly-scoot|dragonfly|Scoot EV|moto|2000|c|80|8|e
sakura-hayate|sakura|Hayate 600|moto|9000|c|220|3.6|
rossa-corsa|rossa|Corsa 1000|moto|150|v|290|2.9|l
`;

export const VEHICLES = Object.freeze(
  RAW.trim()
    .split('\n')
    .map((line) => {
      const [id, brand, model, body, price, cur, kmh, zeroTo100, opts = ''] = line.split('|');
      return Object.freeze({
        id,
        brand,
        name: `${BRANDS[brand].name} ${model}`,
        model,
        body,
        price: Number(price),
        currency: cur === 'v' ? 'vida' : 'cauris',
        kmh: Number(kmh),
        speed: Number(kmh) / 3.6 / 1.6, // m/s en jeu (échelle réduite : la ville fait 400 m)
        accel: ((100 / 3.6 / Number(zeroTo100)) / 1.6) * 1.15, // m/s² en jeu (même échelle que speed)
        electric: opts.includes('e'),
        premiumOnly: opts.includes('p'),
        taxi: opts.includes('t'),
        luxury: opts.includes('l'),
      });
    }),
);

export const VEHICLE_BY_ID = new Map(VEHICLES.map((v) => [v.id, v]));
export const DEFAULT_VEHICLE = 'sakura-kora';
export const MAX_VEHICLE_SPEED = Math.max(...VEHICLES.map((v) => v.speed));
