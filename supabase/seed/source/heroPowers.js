import { FACTIONS } from "./gameSettings";

export const allHeroPowers = [
    {
        faction: FACTIONS.NEUTRAL,
        name: 'Rapid Redeployment',
        text: 'Move a friendly vehicle to any other zone that it is allowed to be in',
        cpCost: 1
    },
    {
        faction: FACTIONS.NEUTRAL,
        name: 'Hero Power Draw',
        text: 'Draw a card',
        cpCost: 1
    },
    {
        faction: FACTIONS.NEUTRAL,
        name: 'Tactical Positioning',
        text: 'Modify starting distance by up to 600m for one battle',
        cpCost: 1
    },
    {
        faction: FACTIONS.NEUTRAL,
        name: 'Salvage',
        text: 'Return destroyed blueprint to hand',
        cpCost: 1
    },
    {
        faction: FACTIONS.DWG,
        name: 'Boarding Party',
        text: 'Choose a friendly DWG faction ship. you may exchange it with one of your opponents Faction ships of equal or lesser cost from the same zone',
        cpCost: 1
    },
    {
        faction: FACTIONS.OW,
        name: 'Change Order',
        text: 'Discard an OW vehicle card. Draw a copy of a player made ship or tank from your deck in two turns',
        cpCost: 1
    },
    {
        faction: FACTIONS.LH,
        name: 'Flyby',
        text: 'Choose a LH vehicle card in hand. Give it the HALFCOST and TEMPORARY keywords.',
        cpCost: 1
    },
    {
        faction: FACTIONS.WF,
        name: 'Flanking maneuver',
        text: 'Choose a zone. The next time you start a fleet battle in that zone this turn, you may deploy after the defender. During that battle, all enemy ships are considered to have FRAGILE keyword',
        cpCost: 1
    },
    {
        faction: FACTIONS.TG,
        name: 'Drones',
        text: 'Spawn a TEMPORARY Mirth swarm into Each zone',
        cpCost: 1
    },
    {
        faction: FACTIONS.SS,
        name: 'Counter intelligence',
        text: 'Grant a friendly vehicle subscreen and airscreen keywords',
        cpCost: 1
    },
];