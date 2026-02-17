#!/usr/bin/env bun
/**
 * Basit Merhaba Dünya programı
 */
export function merhabaDunya(): string {
  const mesaj = "Merhaba Dünya!"
  console.log(mesaj)
  return mesaj
}

// Doğrudan çalıştırıldığında
if (import.meta.main) {
  merhabaDunya()
}
