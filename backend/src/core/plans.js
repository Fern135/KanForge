'use strict';

// What each plan includes. Keep in sync with frontend/site/pricing.html.
// apps: the app ids the plan includes (null = every app).
// maxBoardsPerUser: boards one person can be on in a workspace (null = no limit).
// seatPrice: monthly price per seat in US dollars, used for revenue estimates.
const PLANS = Object.freeze({
  'self-hosted': { name: 'Self-hosted', apps: null, maxBoardsPerUser: null, seatPrice: 0 },
  standard: { name: 'Standard', apps: ['boards', 'notes'], maxBoardsPerUser: 100, seatPrice: 5 },
  plus: { name: 'Plus', apps: null, maxBoardsPerUser: null, seatPrice: 9 },
});

const PLAN_IDS = Object.keys(PLANS);

const planOf = (id) => PLANS[id] || PLANS.standard;
const planIncludesApp = (planId, appId) => {
  const { apps } = planOf(planId);
  return apps === null || apps.includes(appId);
};

module.exports = { PLANS, PLAN_IDS, planOf, planIncludesApp };
