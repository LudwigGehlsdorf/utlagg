// Tiny class-name joiner so styling stays consistent without extra deps.
export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
