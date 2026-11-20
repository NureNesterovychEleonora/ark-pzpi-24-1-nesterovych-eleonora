'use strict';

const { Sequelize } = require('sequelize');

function createSequelize(storage) {
  return new Sequelize({ dialect: 'sqlite', storage, logging: false });
}

module.exports = { createSequelize };
