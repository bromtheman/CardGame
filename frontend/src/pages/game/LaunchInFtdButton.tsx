import { useState } from 'react'
import type { PublicGameState } from '@shared/engine/gameInit'
import type { Side } from '@shared/engine/engineTypes'
import { battleParticipants, otherSide } from '@shared/engine/index'
import { BlueprintResolutionError, buildCustomBattle, serializeCustomBattle } from '@shared/customBattle'
import { CARD_TYPES } from '@shared/gameSettings'

type Battle = NonNullable<PublicGameState['activeBattle']>

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Turn an export failure into something a captain can act on.
 *
 * BlueprintResolutionError's own message is written for a developer ("set
 * blueprintId to a path relative to ..."), and it is the failure players
 * actually hit: create-card stamps every custom card NEUTRAL, and the game
 * ships no NEUTRAL blueprint folder. Which card broke is the part worth saying.
 */
function playerFacingError(e: unknown): string {
  if (e instanceof BlueprintResolutionError) {
    return `Can't export: "${e.card.name}" has no From The Depths vehicle to spawn. ` +
      'Custom cards only exist on the site.'
  }
  return e instanceof Error ? e.message : String(e)
}

/**
 * Exports the current fleet battle as a `.customBattle` file.
 *
 * Opening that file runs the same fight in From The Depths: the game's command-line
 * reader dispatches BootInstruction_LoadCustomBattleFileAndLaunch, which loads it,
 * starts the battle and unpauses. Players need the file association registered once —
 * see scripts/register-custombattle-association.ps1.
 *
 * Neither team is marked IsPlayerTeam, so the match runs as a spectated AI fight and
 * the card game stays the thing being played. Results are reported back by hand.
 *
 * The roster comes from the engine's own `battleParticipants`, not a local
 * reconstruction — BattleOverlay learned that lesson the hard way in wave 7, when a
 * hand-written mirror silently dropped TG Duel's cross-zone hull.
 */
export function LaunchInFtdButton({ state }: { state: PublicGameState }) {
  const [error, setError] = useState<string | null>(null)
  const battle = state.activeBattle
  if (!battle) return null

  const participants = [...battleParticipants(state).values()]
  const vehiclesOn = (side: Side) =>
    participants
      .filter((p) => p.side === side && p.entry.type === CARD_TYPES.VEHICLE)
      .map((p) => ({ name: p.entry.name, faction: p.entry.faction }))

  const defenderSide = otherSide(battle.aggressor)
  const attackers = vehiclesOn(battle.aggressor)
  const defenders = vehiclesOn(defenderSide)
  // FtD needs something on both sides; an empty team produces a battle that
  // ends the instant it starts.
  const bothSidesCrewed = attackers.length > 0 && defenders.length > 0

  function onLaunch(currentBattle: Battle) {
    try {
      const file = buildCustomBattle(
        [
          { name: `${state.factions[currentBattle.aggressor]} (attacking)`, cards: attackers },
          { name: `${state.factions[defenderSide]} (defending)`, cards: defenders },
        ],
        // The card game already decided the engagement range; reuse it rather
        // than dropping the fleets at FtD's 1000m default.
        { spawnDistanceBetweenTeams: currentBattle.distanceM },
      )
      downloadText(`zone-${currentBattle.zoneId}-battle.customBattle`, serializeCustomBattle(file))
      setError(null)
    } catch (e) {
      // Almost always an unmapped blueprint. Surface it rather than downloading
      // a file that would load with a vehicle quietly missing.
      setError(playerFacingError(e))
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={!bothSidesCrewed}
        onClick={() => onLaunch(battle)}
        title={
          bothSidesCrewed
            ? 'Download this battle as a From The Depths custom battle'
            : 'Both sides need at least one vehicle'
        }
        className="rounded border border-brass-400 px-3 py-1.5 text-sm font-bold text-brass-400 disabled:opacity-50"
      >
        Fight in FtD
      </button>
      {error && <p className="max-w-xs text-right text-xs text-red-400">{error}</p>}
    </div>
  )
}
