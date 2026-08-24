import { FACTIONS, TRIGGERS, KEYWORDS } from "../gameSettings";

export const ssVehicles = [
    {
        name: 'Iron Maiden',
        isBuiltIn: true,
        cardText: 'When this vehicle is destroyed, draw a card',
        materialCost: 170000,
        blueprintCost: 174000,
        cpCost: 0,
        imageUrl: 'ironMaiden.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.BLOCKER],
        meta: {
        }
    },{
        name: 'Victoria',
        isBuiltIn: true,
        cardText: 'When this vehicle is destroyed, draw a card',
        materialCost: 270000,
        blueprintCost: 270185,
        cpCost: 0,
        imageUrl: 'victoria.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [],
        meta: {
        }
    },
    {
        name: 'Trondheim',
        isBuiltIn: true,
        cardText: 'When this vehicle is destroyed, draw a card',
        materialCost: 400000,
        blueprintCost: 403000,
        cpCost: 0,
        imageUrl: 'trodnheim.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.BLOCKER],
        meta: {
        }
    },
    {
        name: 'Air Strafe',
        isBuiltIn: true,
        cardText: 'Choose an enemy ship, it fights alone against two predatorX. If the target is a player design, also spawn your choice of hydra or cyclone',
        materialCost: 180000,
        blueprintCost: 0,
        cpCost: 0,
        imageUrl: 'airStrafe.png',
        playerId: null,
        vehicleType: null,
        type: 'ability',
        faction: FACTIONS.SS,
        blueprintId: null,
        meta: {
            [TRIGGERS.PLAY_ON_ZONE]: 'airStrafeEffect'
        }
    },{
        name: 'Repairmen Ready',
        isBuiltIn: true,
        cardText: 'Grant target vehicle scrappy. If the target is an AI vehicle that costs less than 200k, draw a card.',
        materialCost: 0,
        blueprintCost: 0,
        cpCost: 0,
        imageUrl: 'repairmenReady.png',
        playerId: null,
        vehicleType: null,
        type: 'ability',
        faction: FACTIONS.SS,
        blueprintId: null,
        meta: {
            [TRIGGERS.PLAY_ON_VEHICLE]: 'repairmenReadyEffect'
        }
    },{
        name: 'Excalibur',
        isBuiltIn: true,
        cardText: 'Pick one AI ship in hand and reduce its cost by 200k',
        materialCost: 550000,
        blueprintCost: 553900,
        cpCost: 0,
        imageUrl: 'excalibur.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.BLOCKER],
        meta: {
        }
    } ,{
        name: 'Asphodel',
        isBuiltIn: true,
        cardText: '',
        materialCost: 470521,
        blueprintCost: 470000,
        cpCost: 0,
        imageUrl: 'asphodel.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [],
        meta: {
        }
    } ,{
        name: 'Braveheart',
        isBuiltIn: true,
        cardText: 'Once per turn, you may pay 1cp to have this ship 1v1 an enemy vehicle in the same zone',
        materialCost: 370000,
        blueprintCost: 371000,
        cpCost: 0,
        imageUrl: 'Braveheart.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [],
        meta: {
        }
    }
    ,{
        name: 'Tyr',
        isBuiltIn: true,
        cardText: '',
        materialCost: 950000,
        blueprintCost: 983000,
        cpCost: 0,
        imageUrl: 'Tyr.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.BLOCKER],
        meta: {
        }
    }

    ,{
        name: 'Rhea',
        isBuiltIn: true,
        cardText: 'When played, put a random SS plane with a base cost under 300k into your hand. Remove its temporary keyword',
        materialCost: 560000,
        blueprintCost: 563000,
        cpCost: 0,
        imageUrl: 'rhea.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.BLOCKER],
        meta: {
        }
    },{
        name: 'Catshark',
        isBuiltIn: true,
        cardText: 'Whenever this vehicle participates in a fleet combat, gain 30k resources this turn',
        materialCost: 100000,
        blueprintCost: 115450,
        cpCost: 0,
        imageUrl: 'catshark.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [ KEYWORDS.SCRAPPY],
        meta: {
        }
    }, {
        name: 'Sacrilego',
        isBuiltIn: true,
        cardText: 'Whenever this vehicle survives a fleet battle, gain 1cp. Additionally you may sacrifice it to increase the remaining hp percent of a friendly ship by 15',
        materialCost: 80000,
        blueprintCost: 86000,
        cpCost: 0,
        imageUrl: 'sacrilego.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.SCRAPPY, KEYWORDS.STEALTHY, KEYWORDS.MOBILE],
        meta: {
        }
    }, {
        name: 'Resolute',
        isBuiltIn: true,
        cardText: 'When this vehicle is played, draw a card',
        materialCost: 60000,
        blueprintCost: 63300,
        cpCost: 0,
        imageUrl: 'resolute.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [],
        meta: {
        }
    }, {
        name: 'Dryad',
        isBuiltIn: true,
        cardText: 'Whenever this ship participates in a defensive battle, spawn another dryad into the zone under your control',
        materialCost: 40500,
        blueprintCost: 40500,
        cpCost: 0,
        imageUrl: 'dryad.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.BLOCKER],
        meta: {
        }
    }, {
        name: 'Typhoon',
        isBuiltIn: true,
        cardText: '',
        materialCost: 130000,
        blueprintCost: 135323,
        cpCost: 0,
        imageUrl: 'typhoon.png',
        playerId: null,
        vehicleType: 'sub',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.BLOCKER],
        meta: {
        }
    },
     {
        name: 'Cyclone',
        isBuiltIn: true,
        cardText: '',
        materialCost: 280000,
        blueprintCost: 281000,
        cpCost: 0,
        imageUrl: 'typhoon.png',
        playerId: null,
        vehicleType: 'sub',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [],
        meta: {
        }
    },
     {
        name: 'Wolin',
        isBuiltIn: true,
        cardText: '',
        materialCost: 270000,
        blueprintCost: 271000,
        cpCost: 0,
        imageUrl: 'wolin.png',
        playerId: null,
        vehicleType: 'sub',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [],
        meta: {
        }
    },
     {
        name: 'Spectre',
        isBuiltIn: true,
        cardText: '',
        materialCost: 210000,
        blueprintCost: 214000,
        cpCost: 0,
        imageUrl: 'spectre.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.STEALTHY],
        meta: {
        }
    },
    {
        name: 'Falcon Squadron',
        isBuiltIn: true,
        cardText: 'This card is considered destroyed if any of its sub-vehicles is destroyed in battle',
        materialCost: 80000,
        blueprintCost: 96276,
        cpCost: 0,
        imageUrl: 'falcon.png',
        playerId: null,
        vehicleType: 'plane',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.HALF_COST, KEYWORDS.TEMPORARY],
        meta: {
        }
    },  
    {
        name: 'Maelstrom',
        isBuiltIn: true,
        cardText: 'When played, gain 1cp',
        materialCost: 220000,
        blueprintCost: 228000,
        cpCost: 0,
        imageUrl: 'maelstrom.png',
        playerId: null,
        vehicleType: 'plane',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.HALF_COST, KEYWORDS.TEMPORARY],
        meta: {
        }
    },
    {
        name: 'PredatorX',
        isBuiltIn: true,
        cardText: 'While you have more than 120k resources, this card loses its HALFCOST keyword and instead spawns in a second PredatorX',
        materialCost: 120000,
        blueprintCost: 127000,
        cpCost: 0,
        imageUrl: 'predatorX.png',
        playerId: null,
        vehicleType: 'plane',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.HALF_COST, KEYWORDS.TEMPORARY],
        meta: {
        }
    },  
    {
        name: 'Mobula',
        isBuiltIn: true,
        cardText: '',
        materialCost: 600000,
        blueprintCost: 603000,
        cpCost: 0,
        imageUrl: 'mobula.png',
        playerId: null,
        vehicleType: 'plane',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.HALF_COST, KEYWORDS.TEMPORARY],
        meta: {
        }
    },  
    {
        name: 'Hydra',
        isBuiltIn: true,
        cardText: '',
        materialCost: 230000,
        blueprintCost: 238000,
        cpCost: 0,
        imageUrl: 'hydra.png',
        playerId: null,
        vehicleType: 'airship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.MOBILE],
        meta: {
        }
    },
    

];