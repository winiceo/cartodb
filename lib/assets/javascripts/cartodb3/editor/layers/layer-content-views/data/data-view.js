var _ = require('underscore');
var Backbone = require('backbone');
var CoreView = require('backbone/core-view');
var PanelWithOptionsView = require('../../../../components/view-options/panel-with-options-view');
var ScrollView = require('../../../../components/scroll/scroll-view');
var DataContentView = require('./data-content-view');
var DataSQLView = require('./data-sql-view');
var TabPaneView = require('../../../../components/tab-pane/tab-pane-view');
var TabPaneCollection = require('../../../../components/tab-pane/tab-pane-collection');
var Toggler = require('../../../../components/toggler/toggler-view');
var UndoButtons = require('../../../../components/undo-redo/undo-redo-view');
var Infobox = require('../../../../components/infobox/infobox-factory');
var InfoboxModel = require('../../../../components/infobox/infobox-model');
var InfoboxCollection = require('../../../../components/infobox/infobox-collection');
var TableStats = require('../../../../components/modals/add-widgets/tablestats');
var DataColumnsModel = require('./data-columns-model');
var Notifier = require('../../../../components/notifier/notifier');
var SQLUtils = require('../../../../helpers/sql-utils');
var cdb = require('cartodb.js');
var PREFIX_NOTIFICATION_ID = 'visNotification';
var NOTIFICATION_ERROR_TEMPLATE = _.template("<span class='CDB-Text is-semibold u-errorTextColor'><%- info %></span>");
var NOTIFICATION_TEMPLATE = _.template("<span class='CDB-Text is-semibold'><%- info %></span>");

module.exports = CoreView.extend({

  initialize: function (opts) {
    if (!opts.widgetDefinitionsCollection) throw new Error('widgetDefinitionsCollection is required');
    if (!opts.layerDefinitionModel) throw new Error('layerDefinitionModel is required');
    if (!opts.editorModel) throw new Error('editorModel is required');
    if (!opts.configModel) throw new Error('configModel is required');
    if (!opts.stackLayoutModel) throw new Error('StackLayoutModel is required');
    if (!opts.userActions) throw new Error('userActions is required');

    this._layerDefinitionModel = opts.layerDefinitionModel;
    this._widgetDefinitionsCollection = opts.widgetDefinitionsCollection;

    this._userActions = opts.userActions;
    this._userModel = opts.userModel;
    this._configModel = opts.configModel;
    this._editorModel = opts.editorModel;
    this._stackLayoutModel = opts.stackLayoutModel;
    this._nodeModel = this._layerDefinitionModel.getAnalysisDefinitionNodeModel();
    this._querySchemaModel = this._nodeModel.querySchemaModel;

    this._clearSQLModel = new Backbone.Model({
      visible: false
    });

    this._sqlModel = this._layerDefinitionModel.sqlModel;

    this._SQL = new cdb.SQL({
      user: this._configModel.get('user_name'),
      sql_api_template: this._configModel.get('sql_api_template'),
      api_key: this._configModel.get('api_key')
    });

    this._infoboxModel = new InfoboxModel({
      state: ''
    });

    this._tableStats = new TableStats({
      configModel: this._configModel,
      userModel: this._userModel
    });

    this._columnsModel = new DataColumnsModel({}, {
      layerDefinitionModel: this._layerDefinitionModel,
      widgetDefinitionsCollection: this._widgetDefinitionsCollection,
      tableStats: this._tableStats
    });

    this._codemirrorModel = new Backbone.Model({
      content: this._querySchemaModel.get('query'),
      readonly: false
    });

    this._configPanes();
    this._initBinds();
    this._initData();
  },

  render: function () {
    this.clearSubViews();
    this.$el.empty();
    this._initViews();
    return this;
  },

  _initData: function () {
    if (!this._hasFetchedQuerySchema()) {
      this._querySchemaModel.fetch();
    } else {
      this._onQuerySchemaStatusChange();
    }
  },

  _onQuerySchemaChange: function () {
    if (this._hasFetchedQuerySchema()) {
      this._codemirrorModel.set({content: this._querySchemaModel.get('query')});
    }
  },

  _onQuerySchemaStatusChange: function () {
    if (this._hasFetchedQuerySchema()) {
      this._columnsModel.createColumnCollection();
    }
  },

  _hasFetchedQuerySchema: function () {
    return this._querySchemaModel.get('status') === 'fetched';
  },

  _initBinds: function () {
    this.listenTo(this._editorModel, 'change:edition', this._onChangeEdition);
    this.add_related_model(this._editorModel);

    this._querySchemaModel.on('change:query', this._onQuerySchemaChange, this);
    this._querySchemaModel.on('change:status', this._onQuerySchemaStatusChange, this);
    this._querySchemaModel.on('change:query_errors', this._showErrors, this);
    this.add_related_model(this._querySchemaModel);

    this._sqlModel.bind('undo redo', function () {
      this._codemirrorModel.set('content', this._sqlModel.get('content'));
    }, this);
    this.add_related_model(this._sqlModel);
  },

  _parseSQL: function () {
    var query = this._codemirrorModel.get('content');
    var altersData = SQLUtils.altersData(query);

    if (altersData) {
      var notification = Notifier.addNotification({
        status: 'loading',
        info: _t('editor.data.notifier.sql-alter-loading'),
        closable: false
      });

      this._sqlModel.set('content', query);

      this._SQL.execute(query, null, {
        success: function () {
          notification.set({
            status: 'success',
            info: NOTIFICATION_TEMPLATE({info: _t('editor.data.notifier.sql-alter-success')}),
            closable: true
          });
          this._applyDefaultSQL();
        }.bind(this),
        error: function (errors) {
          Notifier.removeNotification(notification);
          errors = errors.responseJSON.error;
          this._codemirrorModel.set('errors', this._parseErrors(errors));
        }.bind(this)
      });
    } else {
      // Parser errors SQL here and saving
      this._querySchemaModel.set({
        status: 'unfetched',
        query: query
      });

      this._querySchemaModel.fetch({
        success: this._saveSQL.bind(this)
      });
    }
  },

  _showErrors: function (model) {
    var errors = this._querySchemaModel.get('query_errors');
    this._codemirrorModel.set('errors', this._parseErrors(errors));

    if (errors && errors.length > 0) {
      Notifier.addNotification({
        status: 'error',
        info: NOTIFICATION_ERROR_TEMPLATE({info: _t('editor.data.notifier.sql-error')}),
        closable: true,
        delay: 10000
      });
    }
  },

  _parseErrors: function (errors) {
    return errors.map(function (error) {
      return {
        message: error
      };
    });
  },

  _saveSQL: function () {
    var query = this._codemirrorModel.get('content');
    this._sqlModel.set('content', query);
    this._userActions.saveAnalysisSourceQuery(query, this._nodeModel, this._layerDefinitionModel);
    this._querySchemaModel.set('query_errors', []);

    this._sqlNotification = Notifier.addNotification({
      id: PREFIX_NOTIFICATION_ID + this.cid,
      status: 'loading',
      info: _t('editor.data.notifier.sql-applying'),
      closable: false
    });

    this._sqlNotification.once('vis:reload', this._updateVisNotification, this);
    this._checkClearButton();
  },

  _updateVisNotification: function () {
    this._sqlNotification.update({
      status: 'success',
      info: NOTIFICATION_TEMPLATE({info: _t('editor.data.notifier.sql-success')}),
      closable: true
    });
  },

  _applyDefaultSQL: function () {
    var originalQuery = this._defaultSQL();
    this._codemirrorModel.set({ content: originalQuery });
    this._sqlModel.set('content', originalQuery);
    this._userActions.saveAnalysisSourceQuery(originalQuery, this._nodeModel, this._layerDefinitionModel);
    this._querySchemaModel.set('query_errors', []);
    this._clearSQLModel.set({ visible: false });
    this._querySchemaModel.resetDueToAlteredData();
  },

  _clearSQL: function () {
    var sql = this._defaultSQL();
    this._codemirrorModel.set({content: sql});
    this._parseSQL();
  },

  _checkClearButton: function () {
    var custom_sql = this._codemirrorModel.get('content').toLowerCase();
    var default_sql = this._defaultSQL().toLowerCase();
    this._clearSQLModel.set({visible: custom_sql !== default_sql});
  },

  _defaultSQL: function () {
    return 'SELECT * FROM ' + this._layerDefinitionModel.getTableName();
  },

  _hasAnalysisApplied: function () {
    return this._nodeModel.get('type') !== 'source';
  },

  _onChangeEdition: function () {
    var edition = this._editorModel.get('edition');
    var isAnalysis = this._hasAnalysisApplied();

    if (edition && isAnalysis) {
      this._codemirrorModel.set({readonly: true});
      this._infoboxModel.set({state: 'readonly'});
    } else {
      this._codemirrorModel.set({readonly: false});
      this._infoboxModel.set({state: ''});
    }

    var index = edition ? 1 : 0;
    this._collectionPane.at(index).set({ selected: true });
  },

  _configPanes: function () {
    var self = this;
    var tabPaneTabs = [{
      selected: !this._editorModel.get('edition'),
      createContentView: function () {
        return new ScrollView({
          createContentView: function () {
            return new DataContentView({
              className: 'Editor-content',
              stackLayoutModel: self._stackLayoutModel,
              widgetDefinitionsCollection: self._widgetDefinitionsCollection,
              columnsModel: self._columnsModel,
              userActions: self._userActions,
              infoboxModel: self._infoboxModel
            });
          }
        });
      },
      createActionView: function () {
        return new CoreView();
      }
    }, {
      selected: this._editorModel.get('edition'),
      createContentView: function () {
        return new DataSQLView({
          layerDefinitionModel: self._layerDefinitionModel,
          codemirrorModel: self._codemirrorModel,
          onApplyEvent: self._parseSQL.bind(self)
        });
      },
      createActionView: function () {
        var isAnalysis = self._hasAnalysisApplied();
        if (!isAnalysis) {
          self._checkClearButton();
          return new UndoButtons({
            trackModel: self._sqlModel,
            editorModel: self._editorModel,
            clearModel: self._clearSQLModel,
            applyButton: true,
            clearButton: true,
            onApplyClick: self._parseSQL.bind(self),
            onClearClick: self._clearSQL.bind(self)
          });
        }
      }
    }];

    this._collectionPane = new TabPaneCollection(tabPaneTabs);
  },

  _confirmReadOnly: function () {
    this._infoboxModel.set({state: ''});
  },

  _initViews: function () {
    var self = this;

    var infoboxSstates = [
      {
        state: 'readonly',
        createContentView: function () {
          return Infobox.createConfirm({
            type: 'code',
            title: _t('editor.data.messages.sql-readonly.title'),
            body: _t('editor.data.messages.sql-readonly.body'),
            confirmLabel: _t('editor.data.messages.sql-readonly.accept')
          });
        },
        mainAction: self._confirmReadOnly.bind(self)
      },
      {
        state: 'no-data',
        createContentView: function () {
          return Infobox.createInfo({
            type: 'alert',
            title: _t('editor.data.messages.empty-data.title'),
            body: _t('editor.data.messages.empty-data.body')
          });
        },
        mainAction: self._confirmReadOnly.bind(self)
      }
    ];

    var infoboxCollection = new InfoboxCollection(infoboxSstates);

    var panelWithOptionsView = new PanelWithOptionsView({
      className: 'Editor-content',
      editorModel: self._editorModel,
      infoboxModel: self._infoboxModel,
      infoboxCollection: infoboxCollection,
      createContentView: function () {
        return new TabPaneView({
          collection: self._collectionPane
        });
      },
      createControlView: function () {
        return new Toggler({
          editorModel: self._editorModel,
          labels: [_t('editor.data.data-toggle.values'), _t('editor.data.data-toggle.cartocss')]
        });
      },
      createActionView: function () {
        return new TabPaneView({
          collection: self._collectionPane,
          createContentKey: 'createActionView'
        });
      }
    });

    this.$el.append(panelWithOptionsView.render().el);
    this.addView(panelWithOptionsView);
  },

  clean: function () {
    this._sqlNotification && this._sqlNotification.off('vis:reload');
    CoreView.prototype.clean.call(this);
  }

});
