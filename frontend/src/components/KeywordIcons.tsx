import shield from '../assets/icons/shieldSVG.svg'
import repair from '../assets/icons/repairSVG.svg'
import hourglass from '../assets/icons/hourglassSVG.svg'
import noFly from '../assets/icons/noFlyZoneSVG.svg'
import noSubs from '../assets/icons/noSubsSVG.svg'
import spark from '../assets/icons/sparkSVG.svg'
import tire from '../assets/icons/tireSVG.svg'
import tire2 from '../assets/icons/tire2SVG.svg'
import crosshair from '../assets/icons/crosshairSVG.svg'
import torpedo from '../assets/icons/torpedoSVG.svg'
import airport from '../assets/icons/airportSVG.svg'

const ICONS: Record<string, string> = {
  blocker: shield, scrappy: repair, temporary: hourglass, airScreen: noFly,
  subScreen: noSubs, halfCost: spark, mobile: tire, robotic: tire2,
  stealthy: crosshair, fragile: torpedo, inoffensive: airport,
}

export function KeywordIcons({ keywords }: { keywords: string[] }) {
  if (keywords.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1">
      {keywords.map((k) =>
        ICONS[k] ? (
          <img key={k} src={ICONS[k]} alt={k} title={k} className="h-6 w-6" />
        ) : (
          <span key={k} title={k} className="rounded bg-ocean-600 px-1 text-xs">{k}</span>
        ),
      )}
    </div>
  )
}
