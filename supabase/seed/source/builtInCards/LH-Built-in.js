import { FACTIONS, TRIGGERS, KEYWORDS, VEHICLE_TYPES } from "../gameSettings";


export const TG_ROBOTICS = [
    {
        name: '[TG] Amusement',
        isBuiltIn: true,
        cardText: '',
        materialCost: 400000,
        blueprintCost: 400000,
        cpCost: 0,
        imageUrl: 'amusement.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.TG,
        blueprintId: null,
        keywords: [KEYWORDS.ROBOTIC, KEYWORDS.MOBILE],
        meta: {
        }
    },
    {
        name: '[TG] Fear',
        isBuiltIn: true,
        cardText: '',
        materialCost: 600000,
        blueprintCost: 614000,
        cpCost: 0,
        imageUrl: 'fear.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.TG,
        blueprintId: null,
        keywords: [KEYWORDS.ROBOTIC],
        meta: {
        }
    },
    {
        name: '[TG] Hysteria',
        isBuiltIn: true,
        cardText: '',
        materialCost: 410000,
        blueprintCost: 414000,
        cpCost: 0,
        imageUrl: 'Hysteria.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.TG,
        blueprintId: null,
        keywords: [KEYWORDS.ROBOTIC],
        meta: {
        }
    },
    {
        name: '[TG] Obsession',
        isBuiltIn: true,
        cardText: '',
        materialCost: 330000,
        blueprintCost: 337000,
        cpCost: 0,
        imageUrl: 'obsession.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.TG,
        blueprintId: null,
        keywords: [KEYWORDS.ROBOTIC],
        meta: {
        }
    },
];


export const lhVehicles = [
    {
        name: 'Ampere',
        isBuiltIn: true,
        cardText: 'When played draw a random card from the [TG] robotics pool',
        materialCost: 200000,
        blueprintCost: 206000,
        cpCost: 0,
        imageUrl: 'ampere.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.LH,
        blueprintId: null,
        keywords: [],
        meta: {
        }
    },
    {
        name: 'Coulomb',
        isBuiltIn: true,
        cardText: 'When this vehicle is destroyed, draw a card',
        materialCost: 120000,
        blueprintCost: 124000,
        cpCost: 0,
        imageUrl: 'Coulomb.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.LH,
        blueprintId: null,
        keywords: [],
        meta: {
            [TRIGGERS.ON_DEATH]: 'coulombEffect'
        }
    },
    {
        name: 'Umbra',
        isBuiltIn: true,
        cardText: '',
        materialCost: 148000,
        blueprintCost: 148000,
        cpCost: 0,
        imageUrl: 'umbra.png',
        playerId: null,
        vehicleType: VEHICLE_TYPES.SUB,
        type: 'vehicle',
        faction: FACTIONS.LH,
        blueprintId: null,
        keywords: [KEYWORDS.STEALTHY],
        meta: {
        }
    },
    {
        name: 'Conduit',
        isBuiltIn: true,
        cardText: 'When this vehicle is destroyed, draw a player made ship or tank card',
        materialCost: 100000,
        blueprintCost: 98000,
        cpCost: 0,
        imageUrl: 'conduit.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.LH,
        blueprintId: null,
        keywords: [],
        meta: {
            [TRIGGERS.ON_DEATH]: 'conduitEffect'
        }
    },
    {
        name: 'Thunderbird',
        isBuiltIn: true,
        cardText: '',
        materialCost: 160000,
        blueprintCost: 168000,
        cpCost: 0,
        imageUrl: 'thunderbird.png',
        playerId: null,
        vehicleType: 'plane',
        type: 'vehicle',
        faction: FACTIONS.LH,
        blueprintId: null,
        keywords: [KEYWORDS.TEMPORARY, KEYWORDS.HALF_COST],
        meta: {
        }
    },
    {
        name: 'Quadrupole',
        isBuiltIn: true,
        cardText: 'When played, draw one card from the [TG] Robotics pool',
        materialCost: 540000,
        blueprintCost: 545000,
        cpCost: 0,
        imageUrl: 'quadrupole.png',
        playerId: null,
        vehicleType: VEHICLE_TYPES.AIRSHIP,
        type: 'vehicle',
        faction: FACTIONS.LH,
        blueprintId: null,
        keywords: [KEYWORDS.BLOCKER, KEYWORDS.SCRAPPY],
        meta: {
        }
    },
    {
        name: 'Terawatt',
        isBuiltIn: true,
        cardText: 'Whenever a friendly vehicle would be made to fight in battle alone due to enemy card effect, you may add this vehicle to the combat.',
        materialCost: 680000,
        blueprintCost: 687000,
        cpCost: 0,
        imageUrl: 'terawatt.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.LH,
        blueprintId: null,
        keywords: [],
        meta: {
        }
    },
    {
        name: 'Angstrom',
        isBuiltIn: true,
        cardText: '',
        materialCost: 540000,
        blueprintCost: 543000,
        cpCost: 0,
        imageUrl: 'angstrom.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.LH,
        blueprintId: null,
        keywords: [],
        meta: {
        }
    },
    {
        name: 'Candela',
        isBuiltIn: true,
        cardText: 'When played, draw one card from the [TG] Robotics pool',
        materialCost: 800000,
        blueprintCost: 878000,
        cpCost: 0,
        imageUrl: 'candela.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.LH,
        blueprintId: null,
        keywords: [KEYWORDS.BLOCKER, KEYWORDS.SUB_SCREEN],
        meta: {
        }
    },
    {
        name: 'Hydrovolt',
        isBuiltIn: true,
        cardText: '',
        materialCost: 260000,
        blueprintCost: 268000,
        cpCost: 0,
        imageUrl: 'hydrovolt.png',
        playerId: null,
        vehicleType: VEHICLE_TYPES.SUB,
        type: 'vehicle',
        faction: FACTIONS.LH,
        blueprintId: null,
        keywords: [KEYWORDS.SUB_SCREEN],
        meta: {
        }
    },
    {
        name: 'Rectifier',
        isBuiltIn: true,
        cardText: '',
        materialCost: 700000,
        blueprintCost: 734000,
        cpCost: 0,
        imageUrl: 'rectifier.png',
        playerId: null,
        vehicleType: 'plane',
        type: 'vehicle',
        faction: FACTIONS.LH,
        blueprintId: null,
        keywords: [KEYWORDS.HALF_COST, KEYWORDS.TEMPORARY],
        meta: {
        }
    },
    {
        name: 'Sapphire',
        isBuiltIn: true,
        cardText: 'When this vehicle is played into an empty zone, draw a card and refund its cost',
        materialCost: 30000,
        blueprintCost: 37085,
        cpCost: 0,
        imageUrl: 'sapphire.png',
        playerId: null,
        vehicleType: 'plane',
        type: 'vehicle',
        faction: FACTIONS.LH,
        blueprintId: null,
        keywords: [KEYWORDS.MOBILE, KEYWORDS.STEALTHY],
        meta: {
            [TRIGGERS.ON_PLAY]: 'sapphireEffect'
        }
    },
    {
        name: 'Eclipse',
        isBuiltIn: true,
        cardText: 'Once per turn this vehicle may target one non-stealthy enemy vehicle in its zone to have a 1v1 battle. If you do so, you may not declare a fleet battle in this zone this turn.',
        materialCost: 220000,
        blueprintCost: 223000,
        cpCost: 0,
        imageUrl: 'eclipse.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.LH,
        blueprintId: null,
        keywords: [],
        meta: {
            [TRIGGERS.ON_ACTIVATE]: 'eclipseEffect'
        }
    },
    {
        name: 'Spectrum',
        isBuiltIn: true,
        cardText: '',
        materialCost: 370000,
        blueprintCost: 372000,
        cpCost: 0,
        imageUrl: 'spectrum.png',
        playerId: null,
        vehicleType: 'plane',
        type: 'vehicle',
        faction: FACTIONS.LH,
        blueprintId: null,
        keywords: [KEYWORDS.HALF_COST, KEYWORDS.TEMPORARY],
        meta: {
            [TRIGGERS.ON_ACTIVATE]: 'spectrumEffect'
        }
    },
    {
        name: 'Sapphire Screen',
        isBuiltIn: true,
        cardText: 'Spawn a friendly Sapphire into each zone. They have MOBILE and STEALTHY keywords',
        materialCost: 90000,
        blueprintCost: 0,
        cpCost: 0,
        imageUrl: 'sapphireScreen.png',
        playerId: null,
        vehicleType: null,
        type: 'ability',
        faction: FACTIONS.LH,
        blueprintId: null,
        meta: {
            [TRIGGERS.ON_PLAY]: 'sapphireScreenEffect'
        }
    },
     {
        name: 'Orbit',
        isBuiltIn: true,
        cardText: 'If you have 140k or more resources, spawn an additional orbit and this card loses HALFCOST keyword',
        materialCost: 140000,
        blueprintCost: 147000,
        cpCost: 0,
        imageUrl: 'orbit.png',
        playerId: null,
        vehicleType: 'plane',
        type: 'vehicle',
        faction: FACTIONS.LH,
        blueprintId: null,
        keywords: [KEYWORDS.HALF_COST, KEYWORDS.TEMPORARY],
        meta: {
            [TRIGGERS.ON_PLAY]: 'orbitEffect',
        }
    },
    {
        name: 'Orbit Flank',
        isBuiltIn: true,
        cardText: 'Choose one: Spawn a friendly orbit into any zone and give it the TEMPORARY keyword, or choose one enemy vehicle and have it fight alone against an orbit',
        materialCost: 90000,
        blueprintCost: 0,
        cpCost: 0,
        imageUrl: 'orbitFlank.png',
        playerId: null,
        vehicleType: null,
        type: 'ability',
        faction: FACTIONS.LH,
        blueprintId: null,
        meta: {
            [TRIGGERS.ON_PLAY]: 'orbitFlankEffect '
        }
    },
    {
        name: 'Robotic Assemblers',
        isBuiltIn: true,
        cardText: 'Choose a [TG] Robotics card to add to your hand',
        materialCost: 50000,
        blueprintCost: 0,
        cpCost: 0,
        imageUrl: 'roboticAssemblers.png',
        playerId: null,
        vehicleType: null,
        type: 'ability',
        faction: FACTIONS.LH,
        blueprintId: null,
        meta: {
            [TRIGGERS.ON_PLAY]: 'roboticAssemblersEffect '
        }
    },

];