import type { LobbySettings } from '@shared/lobbySettings'
import { shortHandNumber } from '@shared/format'
import { BIOME_BORDER, BIOME_TINT } from '../lib/biomeStyles'

// A miniature of the board the lobby is about to become — same zones, same
// left-to-right order, same biome colours as BoardZone, because both read the
// one map in lib/biomeStyles.ts. It is a picture, not a control: nothing here
// is clickable, and it carries no game state because none exists yet.
export function BoardPreview({ settings, size = 'lg' }: {
  settings: LobbySettings
  size?: 'sm' | 'lg'
}) {
  const small = size === 'sm'
  return (
    <div
      className={`flex ${small ? 'gap-1' : 'gap-2'}`}
      role="img"
      aria-label={`Battlefield: ${settings.zones.map((z) => z.biome).join(', ')}`}
    >
      {settings.zones.map((zone, i) => (
        <div
          key={i}
          className={`flex-1 rounded border text-center ${small ? 'px-1 py-2' : 'px-2 py-4'} ${
            BIOME_TINT[zone.biome] ?? 'bg-ocean-900/20'
          } ${BIOME_BORDER[zone.biome] ?? 'border-ocean-600'}`}
        >
          {!small && (
            <>
              <span className="block text-xs text-parchment-100">{zone.biome}</span>
              <span className="block text-xs text-ocean-300">{shortHandNumber(zone.baseHp)}</span>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
