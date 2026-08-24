export const STARTING_HAND_SIZE = 5;
export const STARTING_CP_AMOUNT = 3;

export const DECK_SIZE = 20;
export const PLAYER_CARD_LIMIT = 4;
export const UNIQUE_COPY_LIMIT = 2;

export const GAME_STATUSES = {
    ACTIVE: 'active',
    COMPLETE: 'complete',
    CANCELED: 'canceled',
};

export const GAME_ACTION_TYPES = {
    PLAY_CARD_WITHOUT_TARGET: 'PLAY_CARD_WITHOUT_TARGET',
    PLAY_CARD_TARGETING_CARD_ON_FIELD: 'PLAY_CARD_TARGETING_CARD_ON_FIELD',
    PLAY_CARD_TARGETING_CARD_IN_HAND: 'PLAY_CARD_TARGETING_CARD_IN_HAND',
    SET_ALERT_CARD: 'SET_ALERT_CARD', // this is used to show another player the card you are playing before the effect resolves- ie if card requires a battle to be fought
    PLAY_CARD_TO_ZONE: 'PLAY_CARD_TO_ZONE', // Either plays vehicle or applies ability effect to zone
    ATTACK_ENEMY_BASE: 'ATTACK_ENEMY_BASE',
    SUBMIT_PENDING_CHANGE: 'SUBMIT_PENDING_CHANGE',
    DECIDE_PENDING_CHANGE: 'DECIDE_PENDING_CHANGE',
    END_TURN: 'END_TURN',
};

export const CARD_TYPES = {
    VEHICLE: 'vehicle',
    ABILITY: 'ability',
};

export const VEHICLE_TYPES = {
    SHIP: 'ship',
    AIRSHIP: 'airship',
    TANK: 'tank',
    PLANE: 'plane',
    SUB: 'sub',
};

export const ZONE_TYPES = {
    WATER: 'water',
    BEACH: 'beach',
    LAND: 'land',
};

export const KEYWORDS = {
    AIR_SCREEN: 'airScreen',
    SUB_SCREEN: 'subScreen',
    BLOCKER: 'blocker',
    SCRAPPY: 'scrappy',
    TEMPORARY: 'temporary',
    INOFFENSIVE: 'inoffensive',
    HALF_COST: 'halfCost', // for planes, they are half cost by default
    FRAGILE: 'fragile',
    STEALTHY: 'stealthy', // opt out of defensive battles
    MOBILE: 'mobile', // can change zones once per turn
    ROBOTIC: 'robotic', // Has unlimited resources for repair. Is considered destroyed if any of its sub objects are destroyed
};


export const FACTIONS = {
    NEUTRAL: 'NEUTRAL',
    DWG: 'DWG',
    SS: 'SS',
    LH: 'LH',
    TG: 'TG',
    OW: 'OW',
    SD: 'SD',
    WF: 'WF',
    GT: 'GT',
};

// these are keys that a card can have in its meta that point to a particular effect that triggers at the corresponding time
export const TRIGGERS = {
    ON_PLAY: 'onPlayEffect', // triggers when the card is played without target
    PLAY_ON_ZONE: 'playOnZoneEffect', // triggers against a specified zone
    PLAY_ON_VEHICLE: 'playOnVehicleEffect', // triggers against a specified vehicle (on board)
    PLAY_ON_CARD: 'playOnCardEffect', // triggers against a specified card (in hand)
    ON_DEATH: 'onDeathEffect', // triggers when card is destroyed
    ON_BATTLE_EFFECT: 'onBattleEffect', // triggers when the card is played via battleReport pendingChange. parameter for battle
    ON_BATTLE_VICTORY: 'onBattleVictory',
    ON_BATTLE_DEFEAT: 'onBattleDefeat',
    ON_ACTIVATE: 'onActivate',
};