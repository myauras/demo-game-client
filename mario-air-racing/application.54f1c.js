System.register([], function (_export, _context) {
  "use strict";

  var cc, Application;
  function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
  function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
  function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor); } }
  function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); Object.defineProperty(Constructor, "prototype", { writable: false }); return Constructor; }
  function _toPropertyKey(arg) { var key = _toPrimitive(arg, "string"); return typeof key === "symbol" ? key : String(key); }
  function _toPrimitive(input, hint) { if (_typeof(input) !== "object" || input === null) return input; var prim = input[Symbol.toPrimitive]; if (prim !== undefined) { var res = prim.call(input, hint || "default"); if (_typeof(res) !== "object") return res; throw new TypeError("@@toPrimitive must return a primitive value."); } return (hint === "string" ? String : Number)(input); }
  return {
    setters: [],
    execute: function () {
      _export("Application", Application = /*#__PURE__*/function () {
        function Application() {
          _classCallCheck(this, Application);
          this.settingsPath = 'src/settings.c54bb.json';
          this.showFPS = false;
        }
        _createClass(Application, [{
          key: "init",
          value: function init(engine) {
            cc = engine;
            this.reportMainProgramProgress(30);
            cc.game.onPostBaseInitDelegate.add(this.onPostInitBase.bind(this));
            cc.game.onPostInfrastructureInitDelegate.add(this.onPostInfrastructureInit.bind(this));
            cc.game.onPostSubsystemInitDelegate.add(this.onPostSystemInit.bind(this));
            cc.game.onPostProjectInitDelegate.add(this.onPostProjectInit.bind(this));
          }
        }, {
          key: "onPostInitBase",
          value: function onPostInitBase() {
            this.reportMainProgramProgress(45);
          }
        }, {
          key: "onPostInfrastructureInit",
          value: function onPostInfrastructureInit() {
            var _window$installGoldWe, _window;
            this.reportMainProgramProgress(55);
            if (typeof window !== 'undefined') (_window$installGoldWe = (_window = window).installGoldWebImages) === null || _window$installGoldWe === void 0 || _window$installGoldWe.call(_window, cc);
          }
        }, {
          key: "onPostSystemInit",
          value: function onPostSystemInit() {
            this.reportMainProgramProgress(65);
          }
        }, {
          key: "onPostProjectInit",
          value: function onPostProjectInit() {
            this.reportMainProgramProgress(75);
            var main = cc.assetManager.getBundle('main');
            if (!main || !main.deps.includes('BaseJsons') || cc.assetManager.getBundle('BaseJsons')) return;
            // The loading prefab reads its localized errors before BaseManager starts.
            return new Promise(function (resolve, reject) {
              cc.assetManager.loadBundle('BaseJsons', function (error) {
                return error ? reject(error) : resolve();
              });
            });
          }
        }, {
          key: "start",
          value: function start() {
            var _this = this;
            return cc.game.init({
              debugMode: false ? cc.DebugMode.INFO : cc.DebugMode.ERROR,
              settingsPath: this.settingsPath,
              overrideSettings: {
                screen: {
                  exactFitScreen: false
                },
                profiling: {
                  showFPS: this.showFPS
                }
              }
            }).then(function () {
              _this.installLaunchSceneProgress();
              return cc.game.run();
            });
          }
        }, {
          key: "installLaunchSceneProgress",
          value: function installLaunchSceneProgress() {
            var originalLoadScene = cc.director.loadScene;
            var report = this.reportMainProgramProgress.bind(this);
            cc.director.loadScene = function (sceneName, onProgress, onLoaded) {
              cc.director.loadScene = originalLoadScene;
              var callerProgress = onProgress;
              var callerLoaded = onLoaded;
              if (typeof onLoaded !== 'function') {
                callerLoaded = onProgress;
                callerProgress = null;
              }
              return originalLoadScene.call(this, sceneName, function (finished, total, item) {
                var ratio = total > 0 ? finished / total : 0;
                report(75 + ratio * 24);
                if (typeof callerProgress === 'function') {
                  callerProgress(finished, total, item);
                }
              }, function () {
                report(99);
                if (typeof callerLoaded === 'function') {
                  callerLoaded.apply(void 0, arguments);
                }
              });
            };
          }
        }, {
          key: "reportMainProgramProgress",
          value: function reportMainProgramProgress(percent) {
            if (typeof window.auraSetMainProgramProgress === 'function') {
              window.auraSetMainProgramProgress(percent);
            }
          }
        }]);
        return Application;
      }());
    }
  };
});