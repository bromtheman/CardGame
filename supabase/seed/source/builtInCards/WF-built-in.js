import { FACTIONS, TRIGGERS, KEYWORDS, VEHICLE_TYPES } from "../gameSettings";

export const wfVehicles = [
    {
        name: 'Buzzsaw',
        isBuiltIn: true,
        cardText: 'This vehicle may be omitted from defensive battles unless the attacking enemy force contains a ship or tank',
        materialCost: 80000,
        blueprintCost: 88000,
        cpCost: 0,
        imageUrl: 'buzzsaw.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.WF,
        blueprintId: null,
        keywords: [],
        meta: {
            defensiveOmission: 'unlessShipOrTank',
        }
    },
    {
        name: 'Veles',
        isBuiltIn: true,
        cardText: 'This vehicle may be omitted from defensive battles unless the attacking enemy force contains a ship or tank',
        materialCost: 280000,
        blueprintCost: 286922,
        cpCost: 0,
        imageUrl: 'veles.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.WF,
        blueprintId: null,
        keywords: [],
        meta: {
            defensiveOmission: 'unlessShipOrTank',
        }
    },
    {
        name: 'Excruciator',
        isBuiltIn: true,
        cardText: 'When played, draw a card',
        materialCost: 660000,
        blueprintCost: 663000,
        cpCost: 0,
        imageUrl: 'excruciator.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.WF,
        blueprintId: null,
        keywords: [KEYWORDS.BLOCKER],
        meta: {
            [TRIGGERS.ON_PLAY]: 'excruciatorOnPlay',
        }
    },
    
    {
        name: 'Purifier',
        isBuiltIn: true,
        cardText: 'This ship can only be played into a zone in which you have lost a fleet battle the previous turn. This vehicle does no damage to the enemy base.',
        materialCost: 760000,
        blueprintCost: 765000,
        cpCost: 0,
        imageUrl: 'purifier.png',
        playerId: null,
        vehicleType: VEHICLE_TYPES.SHIP,
        type: 'vehicle',
        faction: FACTIONS.WF,
        blueprintId: null,
        keywords: [KEYWORDS.HALF_COST, KEYWORDS.FRAGILE],
        meta: {
        }
    },
    {
        name: 'Scourge',
        isBuiltIn: true,
        cardText: '',
        materialCost: 240000,
        blueprintCost: 249000,
        cpCost: 0,
        imageUrl: 'scourge.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.WF,
        blueprintId: null,
        keywords: [KEYWORDS.SCRAPPY],
        meta: {
        }
    },
    {
        name: 'Pandemonium',
        isBuiltIn: true,
        cardText: '',
        materialCost: 350000,
        blueprintCost: 354000,
        cpCost: 0,
        imageUrl: 'pandemonium.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.WF,
        blueprintId: null,
        keywords: [KEYWORDS.STEALTHY],
        meta: {
        }
    },
    {
        name: 'The Repentance',
        isBuiltIn: true,
        cardText: '',
        materialCost: 100000,
        blueprintCost: 103000,
        cpCost: 0,
        imageUrl: 'theRepentance.png',
        playerId: null,
        vehicleType: VEHICLE_TYPES.PLANE,
        type: 'vehicle',
        faction: FACTIONS.WF,
        blueprintId: null,
        keywords: [KEYWORDS.TEMPORARY, KEYWORDS.HALF_COST, KEYWORDS.MOBILE],
        meta: {
        }
    },
    {
        name: 'Disemboweler',
        isBuiltIn: true,
        cardText: '',
        materialCost: 300000,
        blueprintCost: 305000,
        cpCost: 0,
        imageUrl: 'disemboweler.png',
        playerId: null,
        vehicleType: VEHICLE_TYPES.SUB,
        type: 'vehicle',
        faction: FACTIONS.WF,
        blueprintId: null,
        keywords: [],
        meta: {
        }
    },
    {
        name: 'Pulverizer',
        isBuiltIn: true,
        cardText: 'Spawn two additional copies of this vehicle into the zone',
        materialCost: 120000,
        blueprintCost: 78000,
        cpCost: 0,
        imageUrl: 'pulverizer.png',
        playerId: null,
        vehicleType: VEHICLE_TYPES.SUB,
        type: 'vehicle',
        faction: FACTIONS.WF,
        blueprintId: null,
        keywords: [],
        meta: {
            additionalSpawns: 2
        }
    },
    {
        name: 'Slasher',
        isBuiltIn: true,
        cardText: '',
        materialCost: 350000,
        blueprintCost: 353000,
        cpCost: 0,
        imageUrl: 'Slasher.png',
        playerId: null,
        vehicleType: VEHICLE_TYPES.SHIP,
        type: 'vehicle',
        faction: FACTIONS.WF,
        blueprintId: null,
        keywords: [],
        meta: {
        }
    },
    {
        name: 'Earth Raker',
        isBuiltIn: true,
        cardText: '',
        materialCost: 50000,
        blueprintCost: 51000,
        cpCost: 0,
        imageUrl: 'earthRaker.png',
        playerId: null,
        vehicleType: VEHICLE_TYPES.SHIP,
        type: 'vehicle',
        faction: FACTIONS.WF,
        blueprintId: null,
        keywords: [KEYWORDS.STEALTHY],
        meta: {
        }
    },
    {
        name: 'The Last Rite',
        isBuiltIn: true,
        cardText: '',
        materialCost: 320000,
        blueprintCost: 329000,
        cpCost: 0,
        imageUrl: 'theLastRite.png',
        playerId: null,
        vehicleType: VEHICLE_TYPES.PLANE,
        type: 'vehicle',
        faction: FACTIONS.WF,
        blueprintId: null,
        keywords: [KEYWORDS.TEMPORARY, KEYWORDS.HALF_COST],
        meta: {
        }
    },
    {
        name: 'Ambush',
        isBuiltIn: true,
        cardText: 'Choose a zone. During the next offensive battle you fight there this turn, you may deploy your ships after the defending player and you may position your ships 600m closer to the enemy. If the turn ends and you have not fought in that zone, draw a card.',
        materialCost: 0,
        blueprintCost: 0,
        cpCost: 0,
        imageUrl: 'ambush.png',
        playerId: null,
        vehicleType: null,
        type: 'ability',
        faction: FACTIONS.WF,
        blueprintId: null,
        meta: {
            [TRIGGERS.PLAY_ON_ZONE]: 'ambushEffect'
        }
    },
    {
        name: 'Martyr Attack',
        isBuiltIn: true,
        cardText: 'Choose an enemy vehicle. It enters a fight alone against 4 Martyrs. If it is an airship, or a player design costing 400k+, it fights 6 Martyrs instead',
        materialCost: 50000,
        blueprintCost: 0,
        cpCost: 0,
        imageUrl: 'MartyrAttack.png',
        playerId: null,
        vehicleType: null,
        type: 'ability',
        faction: FACTIONS.WF,
        blueprintId: null,
        meta: {
            [TRIGGERS.PLAY_ON_VEHICLE]: 'martyrAttackEffect'
        }
    },

    {
        name: 'All for the Cause',
        isBuiltIn: true,
        cardText: 'Choose a zone. Give all friendly vehicles in that zone the TEMPORARY keyword, then spawn a Martyr for each vehicle affected. If the vehicle costed more than 250k, summon two instead.',
        materialCost: 0,
        blueprintCost: 0,
        cpCost: 0,
        imageUrl: 'allForTheCause.png',
        playerId: null,
        vehicleType: null,
        type: 'ability',
        faction: FACTIONS.WF,
        blueprintId: null,
        meta: {
            [TRIGGERS.PLAY_ON_ZONE]: 'allForTheCauseEffect'
        }
    },
    {
        name: 'Pontus',
        isBuiltIn: true,
        cardText: 'When this sub is played into a zone, spawn two additional copies into that same zone.',
        materialCost: 150000,
        blueprintCost: 56000,
        cpCost: 0,
        imageUrl: 'pontus.png',
        playerId: null,
        vehicleType: VEHICLE_TYPES.SUB,
        type: 'vehicle',
        faction: FACTIONS.WF,
        blueprintId: null,
        keywords: [KEYWORDS.FRAGILE],
        meta: {
            additionalSpawns: 2
        }
    },
    {
        name: 'Basher',
        isBuiltIn: true,
        cardText: 'When this is destroyed, draw a card',
        materialCost: 210000,
        blueprintCost: 214000,
        cpCost: 0,
        imageUrl: 'basher.png',
        playerId: null,
        vehicleType: VEHICLE_TYPES.SHIP,
        type: 'vehicle',
        faction: FACTIONS.WF,
        blueprintId: null,
        keywords: [],
        meta: {
            [TRIGGERS.ON_DEATH]: 'basherOnDeath',
        }
    },
    {
        name: 'Harbringer',
        isBuiltIn: true,
        cardText: 'Whenever this ship is in fleet combat, you may spawn in one WF ship that costs <=100k to join the battle',
        materialCost: 550000,
        blueprintCost: 551000,
        cpCost: 0,
        imageUrl: 'harbringer.png',
        playerId: null,
        vehicleType: VEHICLE_TYPES.SHIP,
        type: 'vehicle',
        faction: FACTIONS.WF,
        blueprintId: null,
        keywords: [KEYWORDS.SUB_SCREEN],
        meta: {
            [TRIGGERS.ON_BATTLE_EFFECT]: 'harbringerBattle',
        }
    },
    {
        name: 'Judgement',
        isBuiltIn: true,
        cardText: 'While your opponent has a submarine or airship, this card costs 100k less. Each turn, you may pay 1cp to have this vehicle 1v1 an enemy submarine or airship in this zone.',
        materialCost: 540000,
        blueprintCost: 546000,
        cpCost: 0,
        imageUrl: 'judgement.png',
        playerId: null,
        vehicleType: VEHICLE_TYPES.SHIP,
        type: 'vehicle',
        faction: FACTIONS.WF,
        blueprintId: null,
        keywords: [],
        meta: {
            costModifier: 'judgementCostModifier',
            [TRIGGERS.ON_ACTIVATE]: 'judgementActivate',
            // "Each turn, you may pay 1cp". An activated ability needs BOTH
            // onActivate and a price, or ACTIVATE_VEHICLE refuses it and
            // BoardZone renders no button.
            activateCpCost: 1,
        }
    },
    {
        name: 'Martyr',
        isBuiltIn: true,
        cardText: '',
        materialCost: 8500,
        blueprintCost: 8500,
        cpCost: 0,
        imageUrl: '',
        playerId: null,
        vehicleType: 'plane',
        type: 'vehicle',
        faction: FACTIONS.WF,
        blueprintId: null,
        keywords: [],
        meta: {
            summonOnly: true
        }
    },
];