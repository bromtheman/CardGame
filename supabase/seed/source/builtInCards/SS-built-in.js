import { FACTIONS, TRIGGERS, KEYWORDS } from "../gameSettings";

export const ssVehicles = [
    {
        name: 'Iron Maiden',
        isBuiltIn: true,
        cardText: 'When this vehicle is destroyed, draw a card',
        materialCost: 150000,
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
            [TRIGGERS.ON_DEATH]: 'ironMaidenOnDeath',
        }
    },{
        name: 'Victoria',
        isBuiltIn: true,
        cardText: 'When this vehicle is played, pick one SS ship in hand and reduce its cost by 75k',
        materialCost: 250000,
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
            [TRIGGERS.PLAY_ON_CARD]: 'victoriaOnPlay',
        }
    },
    {
        name: 'Trondheim',
        isBuiltIn: true,
        cardText: 'When this vehicle is destroyed, draw an SS ship from your deck and reduce its cost by 75k',
        materialCost: 375000,
        blueprintCost: 393000,
        cpCost: 0,
        imageUrl: 'trodnheim.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.BLOCKER],
        meta: {
            [TRIGGERS.ON_DEATH]: 'trondheimOnDeath',
        }
    },
    {
        name: 'Air Strafe',
        isBuiltIn: true,
        cardText: 'Choose an enemy vehicle, it fights alone against two predatorX. If the target is a player design, also spawn your choice of hydra or cyclone',
        materialCost: 150000,
        blueprintCost: 0,
        cpCost: 0,
        imageUrl: 'airStrafe.png',
        playerId: null,
        vehicleType: null,
        type: 'ability',
        faction: FACTIONS.SS,
        blueprintId: null,
        meta: {
            [TRIGGERS.PLAY_ON_VEHICLE]: 'airStrafeEffect'
        }
    },{
        name: 'Repairmen Ready',
        isBuiltIn: true,
        cardText: 'Grant target vehicle scrappy. If the target is an SS vehicle that costs less than 400k, draw a card.',
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
        cardText: 'Pick one SS ship in hand and reduce its cost by 200k',
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
            [TRIGGERS.PLAY_ON_CARD]: 'excaliburEffect'
        }
    } ,{
        name: 'Asphodel',
        isBuiltIn: true,
        cardText: '',
        materialCost: 400000,
        blueprintCost: 544000,
        cpCost: 0,
        imageUrl: 'asphodel.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.AIR_SCREEN, KEYWORDS.STEALTHY],
        meta: {
        }
    } ,{
        name: 'Braveheart',
        isBuiltIn: true,
        cardText: 'Once per turn, you may pay 1cp to have one of your ships in this zone 1v1 an enemy vehicle in the same zone',
        materialCost: 350000,
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
            [TRIGGERS.ON_ACTIVATE]: 'braveheartActivate',
            activateCpCost: 1
        }
    }
    ,{
        name: 'Tyr',
        isBuiltIn: true,
        cardText: 'This card costs 60k less for every turn it spends in your hand',
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
            costModifier: 'tyrCostModifier',
        }
    }

    ,{
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
            [TRIGGERS.ON_BATTLE_EFFECT]: 'catsharkBattle',
        }
    }, {
        name: 'Sacrilego',
        isBuiltIn: true,
        cardText: 'Whenever this vehicle participates in a fleet battle, friendly ships receive SCRAPPY keyword for that battle. Whenever this vehicle survives a fleet battle, reduce the cost of SS ships in hand by 30k.',
        materialCost: 10000,
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
            [TRIGGERS.ON_BATTLE_EFFECT]: 'sacrilegoBattle',
        }
    }, {
        name: 'Resolute',
        isBuiltIn: true,
        cardText: 'When this vehicle is played, draw an SS ship from your deck and reduce its cost by 40k',
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
            [TRIGGERS.ON_PLAY]: 'resoluteOnPlay',
        }
    }, {
        name: 'Dryad',
        isBuiltIn: true,
        cardText: 'Whenever this ship participates in a defensive battle, spawn another Dryad under your control into that zone. It fights alongside your fleet in that battle, and stays in the zone if it survives.',
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
            [TRIGGERS.ON_BATTLE_EFFECT]: 'dryadBattle',
            // Retired by the 2026-09-02 balance pass — see the comment on OW:Halberd.
            retired: true,
        }
    }, {
        name: 'Typhoon',
        isBuiltIn: true,
        cardText: 'When played into a zone, summon a second copy of it in that zone',
        materialCost: 130000,
        blueprintCost: 135323,
        cpCost: 0,
        imageUrl: 'typhoon.png',
        playerId: null,
        vehicleType: 'sub',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [],
        meta: {
            // Plain placement data, not an effect: deployVehicle mints the copy
            // from the card in hand, so no catalog is involved and the card
            // names no registry id at all (spec §7.1).
            additionalSpawns: 1,
        }
    },
     {
        name: 'Cyclone',
        isBuiltIn: true,
        cardText: 'When this vehicle is played into a zone, grant every enemy vehicle in that zone FRAGILE',
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
            [TRIGGERS.ON_PLAY]: 'cycloneOnPlay',
        }
    },
     {
        name: 'Argonaut',
        isBuiltIn: true,
        cardText: 'When this vehicle is destroyed, reduce the cost of a random SS ship in your hand by 50k',
        materialCost: 90000,
        blueprintCost: 94000,
        cpCost: 0,
        imageUrl: 'Argonaut.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.SCRAPPY],
        meta: {
            [TRIGGERS.ON_DEATH]: 'argonautOnDeath',
        }
    },
     {
        name: 'Chrysaor',
        isBuiltIn: true,
        cardText: 'While you have more than 150k resources, this card costs 75k more and spawns in a second Chrysaor',
        materialCost: 75000,
        blueprintCost: 116000,
        cpCost: 0,
        imageUrl: 'Chrysaor.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.STEALTHY],
        meta: {
            // "While you have more than 150k resources, this card costs 75k
            // more and spawns in a second Chrysaor." costDelta raises the PLAY
            // price only — base damage and repairs still read 75k.
            //
            // ⚠ The surged price is now EXACTLY the threshold (75k + 75k), so
            // paying for this card turns its own condition off.
            // PLAY_CARD_TO_ZONE reads `surged` BEFORE pay() for that reason.
            resourceSurge: { materialsOver: 150000, extraSpawns: 1, costDelta: 75000 },
        }
    },
     {
        name: 'Paladin',
        isBuiltIn: true,
        cardText: 'When this vehicle is played, gain 1cp. Each turn you may pay 1cp to spawn another paladin into this zone',
        materialCost: 240000,
        blueprintCost: 240000,
        cpCost: 0,
        imageUrl: 'paladin.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [],
        meta: {
            [TRIGGERS.ON_PLAY]: 'paladinOnPlay',
            [TRIGGERS.ON_ACTIVATE]: 'paladinActivate',
            // An activated ability needs onActivate AND a price, or
            // ACTIVATE_VEHICLE refuses it and BoardZone renders no button —
            // silently, in both cases.
            activateCpCost: 1,
        }
    },
     {
        name: 'Nothung',
        isBuiltIn: true,
        cardText: 'When this vehicle is played, reduce the cost of every SS ship in your hand by 40k',
        materialCost: 400000,
        blueprintCost: 478000,
        cpCost: 0,
        imageUrl: 'nothung.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.BLOCKER],
        meta: {
            [TRIGGERS.ON_PLAY]: 'nothungOnPlay',
        }
    },
     {
        name: 'Balmung',
        isBuiltIn: true,
        cardText: 'When this is played into a zone, create a hydra card in hand and reduce its cost to zero',
        materialCost: 620000,
        blueprintCost: 636000,
        cpCost: 0,
        imageUrl: 'balmung.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.BLOCKER],
        meta: {
            [TRIGGERS.ON_PLAY]: 'balmungOnPlay',
        }
    },
     {
        name: 'Blockade',
        isBuiltIn: true,
        cardText: 'Choose a zone, whenever the opponent plays a vehicle into that zone while you have at least one vehicle there, a fleet battle immediately begins in that zone. If you lose with no surviving vehicles, the blockade goes away, otherwise it remains.',
        materialCost: 100000,
        blueprintCost: 0,
        cpCost: 0,
        imageUrl: 'blockade.png',
        playerId: null,
        vehicleType: null,
        type: 'ability',
        faction: FACTIONS.SS,
        blueprintId: null,
        meta: {
            [TRIGGERS.PLAY_ON_ZONE]: 'blockadeEffect',
        }
    },
     {
        name: 'Wolin',
        isBuiltIn: true,
        cardText: '',
        materialCost: 250000,
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
        cardText: 'When this vehicle is played, reduce your opponent CP by 1',
        materialCost: 200000,
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
            [TRIGGERS.ON_PLAY]: 'spectreOnPlay',
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
            [TRIGGERS.ON_PLAY]: 'maelstromOnPlay',
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
            resourceSurge: { materialsOver: 120000, extraSpawns: 1 },
        }
    },
    {
        name: 'Mobula',
        isBuiltIn: true,
        cardText: '',
        materialCost: 500000,
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
        cardText: 'When this vehicle is played, refresh one of your used hero powers then gain 1cp',
        materialCost: 220000,
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
            [TRIGGERS.ON_PLAY]: 'hydraOnPlay',
        }
    },
    {
        name: 'Tiger Shark',
        isBuiltIn: true,
        // Text REWRITTEN by ruling R-1. The changes file printed "whenever this
        // vehicle is played into a zone", which reads as a permanent stacking
        // stamp; the rule shipped is while-alive and non-stacking, and the text
        // says so. zoneCapFor takes the MAX slotDenial in the zone, never the
        // sum, which is what makes a second Tiger Shark inert.
        cardText: 'While this vehicle is alive, your opponent has 3 fewer vehicle slots in this zone. This does not stack.',
        materialCost: 690000,
        blueprintCost: 914000,
        cpCost: 0,
        imageUrl: 'tigerShark.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [],
        meta: {
            slotDenial: 3,
        }
    },
    {
        name: 'Thresher Shark',
        isBuiltIn: true,
        cardText: 'While you have less resources than this costs, you may play it with HALFCOST and INOFFENSIVE',
        materialCost: 580000,
        blueprintCost: 914000,
        cpCost: 0,
        imageUrl: 'thresherShark.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.BLOCKER, KEYWORDS.SUB_SCREEN],
        meta: {
            // "While you have less resources than THIS COSTS" — the threshold is
            // the card's own printed materialCost, which materialsUnder expresses
            // exactly. Ruling B-9's GRANTING arm: a surge that names keywords adds
            // them (to the price AND to the hull) rather than suppressing
            // Half-Cost, which is what the older suppressing surges do.
            resourceSurge: {
                materialsUnder: 580000,
                grantKeywords: [KEYWORDS.HALF_COST, KEYWORDS.INOFFENSIVE],
            },
        }
    },
    {
        name: 'Bull Shark',
        isBuiltIn: true,
        cardText: 'Whenever this survives an offensive fleet battle, deal 200k damage to enemy base in this zone',
        materialCost: 640000,
        blueprintCost: 898000,
        cpCost: 0,
        imageUrl: 'bullShark.png',
        playerId: null,
        vehicleType: 'ship',
        type: 'vehicle',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [KEYWORDS.BLOCKER, KEYWORDS.SUB_SCREEN],
        meta: {
            [TRIGGERS.ON_BATTLE_VICTORY]: 'bullSharkVictory',
        }
    },
    {
        name: 'Cash advance',
        isBuiltIn: true,
        // ⚠ Lowercase "a". This is the delivered name and transform.ts derives
        // the row's uuid from `card:SS:Cash advance` — retitling it mints a new
        // card and orphans every deck holding the old one.
        cardText: 'Gain 150k resources this turn, then draw a card.',
        materialCost: 0,
        blueprintCost: 0,
        cpCost: 2,
        imageUrl: 'cashAdvance.png',
        playerId: null,
        vehicleType: null,
        type: 'ability',
        faction: FACTIONS.SS,
        blueprintId: null,
        keywords: [],
        meta: {
            [TRIGGERS.ON_PLAY]: 'cashAdvanceEffect',
        }
    },

];