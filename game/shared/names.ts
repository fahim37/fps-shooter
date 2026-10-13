/** Callsigns handed to new players until they choose their own. */
const ADJECTIVES = [
  "Swift", "Silent", "Iron", "Rusty", "Grim", "Lucky", "Crimson", "Ashen", "Bold", "Sly",
  "Frost", "Storm", "Shadow", "Brave", "Wild", "Stone", "Ember", "Hollow", "Misty", "Quick",
  "Steel", "Dusky", "Feral", "Noble", "Rogue", "Sharp", "Stout", "Wary", "Keen", "Dark",
];
const NOUNS = [
  "Fox", "Raven", "Wolf", "Hawk", "Viper", "Badger", "Otter", "Lynx", "Falcon", "Boar",
  "Stag", "Heron", "Bear", "Owl", "Hound", "Moth", "Crow", "Pike", "Wren", "Adder",
  "Ranger", "Scout", "Warden", "Hunter", "Ghost", "Rook", "Jackal", "Bison", "Cobra", "Kite",
];

export const NAME_MAX = 16;

/** e.g. "SilentRaven42": at most NAME_MAX characters. */
export function randomName(random = Math.random) {
  const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length)];
  return `${pick(ADJECTIVES)}${pick(NOUNS)}${Math.floor(random() * 90 + 10)}`.slice(0, NAME_MAX);
}
