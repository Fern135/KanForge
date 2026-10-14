'use strict';

// What each plan includes. Keep in sync with the hosted service's pricing page.
// apps: the app ids the plan includes (null = every app).
// maxBoardsPerUser: boards one person can be on in a workspace (null = no limit).
// seatPrice: monthly price per seat in US dollars, used for revenue estimates.
// storageBytes: Files storage per person in the workspace, trash included.
// maxFileBytes: the largest single file one upload can be.
// On self-hosted installs both are null here: a platform admin sets them (none by
// default) in the admin panel instead (see apps/files/limits.js).
const GB = 1024 ** 3;
const PLANS = Object.freeze({
  'self-hosted': {
    name: 'Self-hosted', apps: null, maxBoardsPerUser: null, seatPrice: 0, storageBytes: null, maxFileBytes: null,
  },
  standard: {
    name: 'Standard', apps: ['boards', 'notes', 'files'], maxBoardsPerUser: 100, seatPrice: 5, storageBytes: 5 * GB, maxFileBytes: 2 * GB,
  },
  plus: {
    name: 'Plus', apps: null, maxBoardsPerUser: null, seatPrice: 9, storageBytes: 15 * GB, maxFileBytes: 2 * GB,
  },
});

const PLAN_IDS = Object.keys(PLANS);
// Plans the platform dashboard reports on. Self-hosted workspaces are private:
// they're left out of the dashboard's lists, totals and revenue.
const PAID_PLAN_IDS = PLAN_IDS.filter((id) => id !== 'self-hosted');

const planOf = (id) => PLANS[id] || PLANS.standard;
const planIncludesApp = (planId, appId) => {
  const { apps } = planOf(planId);
  return apps === null || apps.includes(appId);
};

module.exports = { GB, PLANS, PLAN_IDS, PAID_PLAN_IDS, planOf, planIncludesApp };
