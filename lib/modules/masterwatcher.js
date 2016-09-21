var logger = require('pomelo-logger').getLogger('pomelo', __filename);
var utils = require('../util/utils');
var Constants = require('../util/constants');
var MasterWatchdog = require('../master/watchdog');
var fs = require('fs');

module.exports = function(opts, consoleService) {
  return new Module(opts, consoleService);
};

module.exports.moduleId = Constants.KEYWORDS.MASTER_WATCHER;

var Module = function(opts, consoleService) {
  this.app = opts.app;
  this.service = consoleService;
  this.id = this.app.getServerId();

  this.watchdog = new MasterWatchdog(this.app, this.service);
  this.service.on('register', onServerAdd.bind(null, this));
  this.service.on('disconnect', onServerLeave.bind(null, this));
  this.service.on('reconnect', onServerReconnect.bind(null, this));
};

// ----------------- bind methods -------------------------

var onServerAdd = function(module, record) {
  logger.debug('masterwatcher receive add server event, with server: %j', record);
  if(!record || record.type === 'client' || !record.serverType) {
    return;
  }
  module.watchdog.addServer(record);
};

var onServerReconnect = function(module, record) {
  logger.debug('masterwatcher receive reconnect server event, with server: %j', record);
  if(!record || record.type === 'client' || !record.serverType) {
    logger.warn('onServerReconnect receive wrong message: %j', record);
    return;
  }
  module.watchdog.reconnectServer(record);
};

var onServerLeave = function(module, id, type) {
  logger.debug('masterwatcher receive remove server event, with server: %s, type: %s', id, type);
  if(!id) {
    logger.warn('onServerLeave receive server id is empty.');
    return;
  }
  if(type !== 'client') {
    module.watchdog.removeServer(id);
    //检测是正常重启还是异常断开
    fs.exists('/root/pomelo_history.log', function(exists){
        if(!exists){
            return logger.error('file pomelo_history is not exists.');
        }
        fs.readFile('/root/pomelo_history.log', 'utf8', function(err, data){
            if(err){
                return logger.error('readFile pomelo_history failed!');
            }
            //检查最后一行是否重启pomelo，正常重启则忽略不作任何操作，异常才短信提醒
            if(data.lastIndexOf('stoping pomelo (restart)') !== (data.length - 25)){
                //发送短信提醒
                var content = '服务器异常断开：' + id;
                var options = {
                  host: 'api.tuishiben.com',
                  port: 80,
                  path: '/groups/services/rest/test/sendAlertSMS/json?to=15680039281&content=' + encodeURIComponent(content),
                  method: 'GET'
                };
                request(options, null, function(err, result){
                  if(err){
                    return logger.error('发送提醒短信失败：' + err);
                  }
                  logger.info('发送提醒短信成功：' + content);
                });
            }
        });
    });
  }
};

var request = function(options, data, callback) {
      var req1 = require('http').request(options, function (res1) {
          var data = '';
          res1.on('data', function (d) {
              if (res1.statusCode == 200) {
                  data += d;
              } else if (res1.statusCode == 500) {
                  callback('500 error', null);
              }
          });
          res1.on('end', function () {
              callback(null, data.toString('utf8'));
          });
      }).on('error', function (e) {
          callback(e, null);
      });
      if (data != null) {
          req1.write(data);
      }
      req1.end();
  };

// ----------------- module methods -------------------------

Module.prototype.start = function(cb) {
  utils.invokeCallback(cb);
};

Module.prototype.masterHandler = function(agent, msg, cb) {
  if(!msg) {
    logger.warn('masterwatcher receive empty message.');
    return;
  }
  var func = masterMethods[msg.action];
  if(!func) {
    logger.info('masterwatcher unknown action: %j', msg.action);
    return;
  }
  func(this, agent, msg, cb);
};

// ----------------- monitor request methods -------------------------

var subscribe = function(module, agent, msg, cb) {
  if(!msg) {
    utils.invokeCallback(cb, new Error('masterwatcher subscribe empty message.'));
    return;
  }

  module.watchdog.subscribe(msg.id);
  utils.invokeCallback(cb, null, module.watchdog.query());
};

var unsubscribe = function(module, agent, msg, cb) {
  if(!msg) {
    utils.invokeCallback(cb, new Error('masterwatcher unsubscribe empty message.'));
    return;
  }
  module.watchdog.unsubscribe(msg.id);
  utils.invokeCallback(cb);
};

var query = function(module, agent, msg, cb) {
  utils.invokeCallback(cb, null, module.watchdog.query());
};

var record = function(module, agent, msg) {
  if(!msg) {
    utils.invokeCallback(cb, new Error('masterwatcher record empty message.'));
    return;
  }
  module.watchdog.record(msg.id);
};

var masterMethods = {
  'subscribe': subscribe,
  'unsubscribe': unsubscribe,
  'query': query,
  'record': record
};
