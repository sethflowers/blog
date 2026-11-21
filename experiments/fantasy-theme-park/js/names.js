// Name suggestions: for parks, and for lands of each theme. All made up here.
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const PARK_A = ['Everwood', 'Silverlake', 'Starfall', 'Moonhaven', 'Dragonmere', 'Wyvernhold', 'Glimmerdale', 'Thornbury', 'Ravenspire', 'Goldmeadow',
  'Lanternfield', 'Brightwater', 'Mistral', 'Oakenshaw', 'Fablewick', 'Emberhill', 'Crownhollow', 'Willowmere', 'Highcastle', 'Sunspire'];
const PARK_B = ['Kingdom', 'Realm', 'Gardens', 'Wonderland', 'Adventure Park', 'Pleasure Gardens', 'Fair', 'Park', 'Fantasy Park', 'Isles', 'Valley'];
export function parkName(){ return pick(PARK_A) + ' ' + pick(PARK_B); }

export const THEMES = {
  main:     { name: 'Main Street',     color: '#c8a050', words: [['Grand', 'Market', 'Old', 'Royal', 'Lantern', 'Clocktower', 'Victoria', 'Promenade'], ['Street', 'Square', 'Avenue', 'Row', 'Arcade', 'Parade']] },
  castle:   { name: 'Castle Town',     color: '#7a90c8', words: [['Kingsbridge', 'Crown', 'Banner', 'Highgate', 'Lionheart', 'Silver', 'Merlin\'s'], ['Town', 'Keep', 'Court', 'Hill', 'Market', 'Bailey']] },
  wood:     { name: 'Enchanted Wood',  color: '#5a9a5a', words: [['Whispering', 'Enchanted', 'Moonlit', 'Fernwild', 'Elderwood', 'Toadstool', 'Glowworm'], ['Wood', 'Glade', 'Hollow', 'Thicket', 'Dell', 'Grove']] },
  dragon:   { name: 'Dragon\'s Reach', color: '#c85a3a', words: [['Dragon\'s', 'Wyrm', 'Ember', 'Cinder', 'Obsidian', 'Ashen', 'Scorch'], ['Reach', 'Peak', 'Lair', 'Crag', 'Forge', 'Spire']] },
  pirate:   { name: 'Pirate Harbour',  color: '#3a8aa8', words: [['Pirate', 'Smuggler\'s', 'Blackwater', 'Skull', 'Saltwind', 'Corsair', 'Mermaid'], ['Harbour', 'Cove', 'Bay', 'Wharf', 'Landing', 'Point']] },
  frontier: { name: 'Frontier Gulch',  color: '#c8784a', words: [['Gold Rush', 'Rattlesnake', 'Dusty', 'Red Rock', 'Copper', 'Lone Pine', 'Buzzard'], ['Gulch', 'Canyon', 'Creek', 'Junction', 'Ridge', 'Flats']] },
  sky:      { name: 'Sky Kingdom',     color: '#9a8ad8', words: [['Sky', 'Cloud', 'Aether', 'Starlight', 'Zephyr', 'Crystal', 'Aurora'], ['Kingdom', 'Isles', 'Harbour', 'Heights', 'Citadel', 'Reach']] },
};
export function landName(theme){ const w = (THEMES[theme] || THEMES.main).words; return pick(w[0]) + ' ' + pick(w[1]); }
