(function() {
    var Ext = window.Ext4 || window.Ext;

    Ext.define('Rally.apps.customlist.CustomListApp', {
        extend: 'Rally.app.GridBoardApp',
        requires: [
            'Deft.Promise',
            'Rally.apps.customlist.Settings',
            'Rally.data.BulkRecordUpdater',
            'Rally.data.ModelTypes',
            'Rally.data.PreferenceManager',
            'Rally.data.util.Sorter',
            'Rally.data.wsapi.Filter',
            'Rally.ui.gridboard.plugin.GridBoardInlineFilterControl',
            'Rally.ui.gridboard.plugin.GridBoardSharedViewControl',
            'Rally.ui.notify.Notifier',
            'Rally.util.String'
        ],

        disallowedAddNewTypes: ['user', 'userprofile', 'useriterationcapacity', 'testcaseresult', 'task', 'scmrepository', 'project', 'changeset', 'change', 'builddefinition', 'build', 'program'],
        orderedAllowedPageSizes: [10, 25, 50, 100, 200],
        readOnlyGridTypes: ['build', 'change', 'changeset'],
        statePrefix: 'customlist',
        allowExpansionStateToBeSaved: false,
        isEditable: true,

        config: {
            defaultSettings: {
                showControls: true,
                type: 'PortfolioItem/Feature'
            }
        },

        initComponent: function () {
        	// console.log('blackList', _.union(Rally.ui.grid.FieldColumnFactory.getBlackListedFieldsForTypes(this._getModelTypes()),
         //        this.gridFieldBlackList));
            this.appName = 'CustomList-' + this.getAppId();
            if (this.defaultSettings.url) {
                Ext.apply(this.defaultSettings, { type: this.defaultSettings.url });
            }
            this.callParent(arguments);
        },

        getSettingsFields: function() {
            return Rally.apps.customlist.Settings.getFields(this);
        },

        loadModelNames: function () {
            this.modelNames = _.compact(this.getTypeSetting());
            this._setColumnNames(this._getColumnNamesSetting());
            return Deft.Promise.when(this.modelNames);
        },

        addGridBoard: function () {
            this.callParent(arguments);

            if (!this.getSetting('showControls')) {
                this.gridboard.getHeader().hide();
            }

            this.gridboard.config.columnCfgs = [
        						'Name',
                                'State',
                                'Priority',
                                'c_FeatureElaboratingDate'
        	];
        },

        loadGridBoard: function () {
            if (_.isEmpty(this.modelNames)) {
                Ext.defer(function () {
                    this.fireEvent('settingsneeded', this);
                    this.publishComponentReady();
                }, 1, this);
            } else {
                this.enableAddNew = this._shouldEnableAddNew();
                this.enableRanking = this._shouldEnableRanking();
                this.callParent(arguments);
            }
        },

        getGridConfig: function () {
            var config = _.merge(this.callParent(arguments), {
                allColumnsStateful: true,
                enableEditing: _.intersection(this.readOnlyGridTypes, this.getTypeSetting()).length === 0,
                listeners: {
                    beforestaterestore: this._onBeforeGridStateRestore,
                    beforestatesave: this._onBeforeGridStateSave,
                    scope: this
                },
                pagingToolbarCfg: {
                    hidden: !this.getSetting('showControls'),
                    pageSizes: this.orderedAllowedPageSizes
                }
            });

            var invalidQueryFilters = Rally.util.Filter.findInvalidSubFilters(this._getQueryFilter(), this.models);
            if (invalidQueryFilters.length) {
                config.store.on('beforeload', function (store) {
                    Ext.defer(function () {
                        store.fireEvent('load', store, store.getRootNode(), [], true);
                    }, 1);
                    return false;
                });
                this._showInvalidQueryMessage(config, _.map(invalidQueryFilters, function (filter) {
                    return 'Could not find the attribute "'+ filter.property.split('.')[0] +'" on type "'+ this.models[0].displayName +'" in the query segment "'+ filter.toString() + '"';
                }, this));
            }

            return config;
        },

        getColumnCfgs: function() {
            return _.union(this.callParent(arguments), _.isEmpty(this.columnNames) && this.enableRanking ? ['DragAndDropRank'] : []);
        },

        getFilterControlConfig: function () {
            return _.merge(this.callParent(arguments), {
                listeners: {
                    beforestaterestore: {
                        fn: this._onBeforeFilterButtonStateRestore,
                        scope: this
                    }
                }
            });
        },

        getGridBoardCustomFilterControlConfig: function() {
            var context = this.getContext();
            var isArtifactModel = this.models[0].isArtifact();
            var blackListFields = isArtifactModel ? ['ModelType', 'PortfolioItemType', 'LastResult'] : ['ArtifactSearch', 'ModelType'];
            var whiteListFields = isArtifactModel ? ['Milestones', 'Tags', 'c_CapitalizableDate', 'c_FeatureElaboratingDate'] : [];

            if (this.models[0].isProject()) {
                blackListFields.push('SchemaVersion');
            } else if (this.models[0].isRelease()) {
                blackListFields.push('ChildrenPlannedVelocity', 'Version');
            }

            var config = {
                ptype: 'rallygridboardinlinefiltercontrol',
                inlineFilterButtonConfig: {
                    stateful: true,
                    stateId: context.getScopedStateId('custom-list-inline-filter'),
                    legacyStateIds: [
                        this.getScopedStateId('owner-filter'),
                        this.getScopedStateId('custom-filter-button')
                    ],
                    filterChildren: true,
                    inlineFilterPanelConfig: {
                        quickFilterPanelConfig: {
                            defaultFields: isArtifactModel ? ['ArtifactSearch', 'Owner'] : [],
                            addQuickFilterConfig: {
                                blackListFields: blackListFields,
                                whiteListFields: whiteListFields
                            }
                        },
                        advancedFilterPanelConfig: {
                            advancedFilterRowsConfig: {
                                propertyFieldConfig: {
                                    blackListFields: blackListFields,
                                    whiteListFields: whiteListFields
                                }
                            }
                        }
                    }
                }
            };

            if (isArtifactModel) {
                config.inlineFilterButtonConfig.modelNames = this.modelNames;
            } else {
                config.inlineFilterButtonConfig.model = this.models[0];
            }

            return config;
        },

        getSharedViewConfig: function() {
            var context = this.getContext();
            return {
                ptype: 'rallygridboardsharedviewcontrol',
                sharedViewConfig: {
                    stateful: true,
                    stateId: context.getScopedStateId('custom-list-shared-view'),
                    enableUrlSharing: this.isFullPageApp !== false
                }
            };
        },

        getGridBoardConfig: function () {
            var config = this.callParent(arguments);
            return _.merge(config, {
                listeners: {
                    viewchange: function() {
                        this.loadGridBoard();
                    },
                    filterchange: function() {
                        this.gridboard.getGridOrBoard().noDataPrimaryText = undefined;
                        this.gridboard.getGridOrBoard().noDataSecondaryText = undefined;
                    },
                    scope: this
                }
            });
        },

        onTreeGridReady: function (grid) {
            if (grid.store.getTotalCount() > 10) {
                this.gridboard.down('#pagingToolbar').show();
            }

            this.callParent(arguments);

            console.log('grid:', this.gridboard.plugins[2]);
            // this.gridboard.plugins[2].updateFields(['Name', 'c_CapitalizableDate']);
        },

        getGridStoreConfig: function () {
            var sorters = this._getValidSorters(Rally.data.util.Sorter.sorters(this.getSetting('order')));

            if (_.isEmpty(sorters)) {
                var rankField = this.getContext().getWorkspace().WorkspaceConfiguration.DragDropRankingEnabled ? 'DragAndDropRank' : 'Rank';
                var defaultSort = Rally.data.ModelTypes.areArtifacts(this.modelNames) ? rankField : Rally.data.util.Sorter.getDefaultSort(this.modelNames[0]);

                sorters = Rally.data.util.Sorter.sorters(defaultSort);
            }

            return {
                listeners: {
                    warning: {
                        fn: this._onGridStoreWarning,
                        scope: this
                    }
                },
                pageSize: 10,
                sorters: sorters
            };
        },

        getAddNewConfig: function () {
            var config = {
                minWidth: 700,
                openEditorAfterAddFailure: false,
                margin: 0
            };

            return _.merge(this.callParent(arguments), config);
        },

        getFieldPickerConfig: function () {
            return _.merge(this.callParent(arguments), {
                buttonConfig: {
                    disabled: !this._userHasPermissionsToEditPanelSettings()
                },
                gridAlwaysSelectedValues: function () { return []; },
                gridFieldBlackList: this._shouldEnableRanking() ? [] : ['Rank']
            });
        },

        getPermanentFilters: function () {
            return this._getQueryFilter().concat(this._getTimeboxScopeFilter()).concat(this._getProjectFilter());
        },

        onTimeboxScopeChange: function() {
            this.callParent(arguments);
            this.loadGridBoard();
        },

        clearFiltersAndSharedViews: function() {
            var context = this.getContext();
            if (this.gridboard) {
                this.gridboard.down('rallyinlinefilterpanel').clear();
                this.gridboard.down('rallysharedviewcombobox').reset();
            }

            Ext.create('Rally.data.wsapi.Store', {
                model: Ext.identityFn('preference'),
                autoLoad: true,
                filters: [
                    {property: 'AppId', value: context.getAppId()},
                    {property: 'Type', value: 'View'},
                    {property: 'Workspace', value: context.getWorkspace()._ref}
                ],
                context: context.getDataContext(),
                listeners: {
                    load: function(store, records) {
                        if(!_.isEmpty(records)) {
                            var batchStore = Ext.create('Rally.data.wsapi.batch.Store', {
                                requester: this,
                                data: records
                            });
                            batchStore.removeAll();
                            batchStore.sync();
                        }
                        store.destroyStore();
                    },
                    scope: this
                }
            });
        },

        getTypeSetting: function() {
            return (this.getSetting('type') || this.getSetting('url') || '').toLowerCase().split(',');
        },

        _getColumnNamesSetting: function() {
        	console.log('getColumnNames', this.getSetting('columnNames'));
            return this.getSetting('columnNames') ||
              (this.getSetting('fetch') || '').split(',');
        },

        _getQueryFilter: function () {
            var query = new Ext.Template(this.getSetting('query')).apply({
                projectName: this.getContext().getProject().Name,
                projectOid: this.getContext().getProject().ObjectID,
                user: this.getContext().getUser()._ref
            });
            if (query) {
                try {
                    return [ Rally.data.wsapi.Filter.fromQueryString(query) ];
                } catch(e) {
                    Rally.ui.notify.Notifier.showError({ message: e.message });
                }
            }
            return [];
        },

        _getProjectFilter: function () {
            return this.modelNames[0].toLowerCase() === 'milestone' ? [
                Rally.data.wsapi.Filter.or([
                    { property: 'Projects', operator: 'contains', value: this.getContext().getProjectRef() },
                    { property: 'TargetProject', operator: '=', value: null }
                ])
            ] : [];
        },

        _getTimeboxScopeFilter: function () {
            var timeboxScope = this.getContext().getTimeboxScope();
            var hasTimeboxField = timeboxScope && _.any(this.models, timeboxScope.isApplicable, timeboxScope);
            return hasTimeboxField ? [ timeboxScope.getQueryFilter() ] : [];
        },

        _shouldEnableAddNew: function() {
            return _.intersection(this.disallowedAddNewTypes, this.getTypeSetting()).length === 0;
        },

        _shouldEnableRanking: function() {
            return !_.contains(this.getTypeSetting(), 'task');
        },

        _setColumnNames: function (columnNames) {
            this.columnNames = _.compact(_.isString(columnNames) ? columnNames.split(',') : columnNames);
            console.log('setting columns:', this.columnNames);
        },

        _onBeforeFilterButtonStateRestore:  function (filterButton, state) {
            if (state && state.filters && state.filters.length) {
                var stateFilters = _.map(state.filters, function (filterStr) {
                    return Rally.data.wsapi.Filter.fromQueryString(filterStr);
                });
                var validFilters = Rally.util.Filter.removeNonapplicableTypeSpecificFilters(stateFilters, this.models);
                state.filters = _.invoke(validFilters, 'toString');
            }
        },

        _hasViewSelected: function() {
            var sharedViewConfig = this.getSharedViewConfig().sharedViewConfig;
            if (sharedViewConfig && sharedViewConfig.stateId) {
                var value = (Ext.state.Manager.get(sharedViewConfig.stateId) || {}).value;

                return !_.isEmpty(value);
            }
            return false;
        },

        _onBeforeGridStateRestore: function (grid, state) {
            if (!state) {
                return;
            }

            if (state.columns) {
            	console.log('state', state);
            	console.log('state.columns', state.columns);
            	console.log('this.getColumnCfgs()', this.getColumnCfgs());
                var appScopedColumnNames = this._getValidUuids(grid, this.getColumnCfgs());
                var userScopedColumnNames = this._getValidUuids(grid, state.columns);

                console.log('app scoped columns:', appScopedColumnNames);

                if (this._hasViewSelected()) {
                    state.columns = userScopedColumnNames;
                } else {

                    // Get the columns that are present in the app scope and not in the user scope
                    var differingColumns = _.difference(appScopedColumnNames, userScopedColumnNames);

                    // If there are columns in the app scope that are not in the
                    // user scope, append them to the user scope to preserve
                    // user scope column order
                    if (differingColumns.length > 0) {
                        state.columns = state.columns.concat(differingColumns);
                    }

                    // Filter out any columns that are in the user scope that are not in the
                    // app scope
                    state.columns = _.filter(state.columns, function (column) {
                        return _.contains(appScopedColumnNames, _.isObject(column) ? column.dataIndex : column);
                    }, this);
                }
            }

            if (state.sorters) {
                state.sorters = this._getValidSorters(state.sorters);
                if (_.isEmpty(state.sorters)) {
                    delete state.sorters;
                }
            }
        },

        _getValidUuids: function(grid, columns) {
            return _.reduce(columns, function(result, column) {
                var dataIndex =  this._getColumnDataIndex(column);
                var field = this._getModelField(grid, dataIndex);

                if (field) {
                    result.push(dataIndex);
                }

                return result;
            }, [], this);
        },

        _getModelField: function(grid, dataIndex) {
        	//console.log('grid',grid);
        	console.log('dataIndex',dataIndex);
        	console.log('model ', grid.getModels()[0].getField(dataIndex));
            return grid.getModels()[0].getField(dataIndex);
        },

        _getColumnDataIndex: function(column) {
            return _.isObject(column) ? column.dataIndex : column;
        },

        _onBeforeGridStateSave: function (grid, state) {
        	console.log('grid:', grid);
        	console.log('state:', state);
        	console.log('c config', grid.config.columnCfgs);

            var newColumnNames = this._getColumnNamesFromState(state);

            if (!_.isEmpty(newColumnNames)) {
                this._setColumnNames(newColumnNames);

                if (this._userHasPermissionsToEditPanelSettings()) {
                    this.updateSettingsValues({
                        settings: {
                            columnNames: newColumnNames.join(',')
                        }
                    });
                }
            }
        },

        _onGridStoreWarning: function(store, warnings, operation) {
            var couldNotParseWarnings = _.filter(warnings, function(warning){
                return Rally.util.String.startsWith(warning, 'Could not parse ');
            });
            if(couldNotParseWarnings.length) {
                _.assign(operation.resultSet, {
                    count: 0,
                    records: [],
                    total: 0,
                    totalRecords: 0
                });
                this._showInvalidQueryMessage(this.gridboard.getGridOrBoard(), couldNotParseWarnings);
            }
        },

        _showInvalidQueryMessage: function(gridOrGridConfig, secondaryTextStrings) {
            gridOrGridConfig.noDataPrimaryText = 'Invalid Query';
            gridOrGridConfig.noDataSecondaryText = _.map(secondaryTextStrings, function(str){
                return '<div>' + str + '</div>';
            }).join('');
        },

        _getValidSorters: function (sorters) {
            return _.filter(sorters, function (sorter) {
                return _.any(this.models, function (model) {
                    var field = model.getField(sorter.property);
                    return field && field.sortable;
                });
            }, this);
        },

        _userHasPermissionsToEditPanelSettings: function () {
            return this.isEditable;
        },

        _getColumnNamesFromState: function (state) {
        	console.log('column from state:', state);
            return _(state && state.columns).map(function (newColumn) {
                return _.isObject(newColumn) ? newColumn.dataIndex : newColumn;
            }).compact().value();
        }
    });


    /**
     * A picker which allows selecting one or more fields for a type.
     *
     *      @example
     *      Ext.create('Ext.Container', {
     *          items: [{
     *              xtype: 'rallyfieldpicker',
     *              autoExpand: true,
     *              modelTypes: ['Defect']
     *          }],
     *          renderTo: Ext.getBody().dom
     *      });
     */
    Ext.define('Rally.ui.picker.FieldPicker', {
        alias: 'widget.rallyfieldpicker',
        extend:  Rally.ui.picker.MultiObjectPicker ,
                                                                 

        margin: '10px 0 255px 0',
        maxLength: 32,
        readyEvent: 'ready',
        width: 300,

        clientMetrics: [
            // first two pulled forward from MultiObjectPicker
            // so far there is no way to merge/override clientMetric
            // configs from base classes
            {
                beginMethod: 'expand',
                endMethod: '_onStoreLoad',
                description: 'object picker loaded'
            },
            {
                method: '_onListItemClick',
                description: 'list item clicked'
            },
            {
                event: 'focus',
                description: 'field picker focused'
            },
            {
                event: 'blur',
                description: 'field picker blurred'
            }
        ],

        config: {
            maxLength: 32,

            /**
             * @cfg {config}
             * The configuration for the inputText toolTip.
             */
            toolTipConfig: {
                html: '<h3 class="tooltip-heading">Field Picker Tip</h3><div class="tooltip-text">Start typing in the box to filter fields.</div>',
                destroyAfterHide: true,
                showOnClick: true,
                closable: true
            },

            /**
             * @cfg {String}
             * The label for the selected section
             */
            selectedTextLabel: 'Selected Fields',

            /**
             * @cfg {String}
             * The label for the available section
             */
            availableTextLabel: 'Available Fields',

            listCfg: {
                emptyText: '<div class="rui-multi-object-picker-empty-text">Type to filter fields</div>'
            },

            filterFieldName: 'displayName',

            recordKey: 'name',

            selectionKey: 'name',

            /**
             * @cfg {Boolean}
             * Whether rows are selectable
             */
            rowSelectable: true,

            /**
             * @cfg {String[]} modelTypes the types for which fields will be displayed
             */
            modelTypes: [],

            /**
             * @cfg {String[]}
             * Names of the fields to show on the type dropdown
             */
            fieldWhiteList: [],

            /**
             * @cfg {String[]}
             * Names of the fields to hide on the type dropdown
             */
            fieldBlackList: [],

            /**
             * @cfg {Boolean}
             * show all custom-fields on the type dropdown
             */
            showAllCustomFields: true,

            /**
             * @cfg {Boolean}
             * If true, allows containers with this field to notify the field using #refreshWithNewContext
             * when the context changes (new project or workspace scoping).
             */
            shouldRespondToScopeChange: true,

            pickerCfg: {
                style: {
                    border: '1px solid #DDD',
                    'border-top': 'none'
                },
                height: 248,
                shadow: false
            },

            /**
             * @cfg {Boolean}
             * Whether to render the picker always expanded
             */
            alwaysExpanded: true,

            pickerAlign: 'tl-bl',

            /**
             * @cfg {Boolean}
             * Whether to maintain the scroll position
             */
            maintainScrollPosition: true
        },

        constructor: function(config) {
            console.log('constructing ...............');
            this.enableGrouping = true;

            this.mergeConfig(config);
            this.callParent([this.config]);
        },

        initComponent: function() {
            console.log('initing ...............');
            this.addEvents(
                /**
                 * @event
                 * @param Rally.ui.picker.FieldPicker picker This instance
                 * @param Ext.data.Store store This instance's store, which has been loaded
                 */
                'fieldpickerstoreloaded'
            );
            this.callParent(arguments);
        },

        getStore: function() {
            return this.store;
        },

        _fieldIsInWhiteList: function(field) {
            // console.log('field in whitelist', field);
            // return !field.custom && (!this.fieldWhiteList.length || Ext.Array.contains(this.fieldWhiteList, field.name));
            return !this.fieldWhiteList.length || Ext.Array.contains(this.fieldWhiteList, field.name);
        },

        _fieldIsInBlackList: function(field) {
            return Ext.Array.contains(this.fieldBlackList, field.name);
        },

        _shouldShowCustomField: function(field) {
            console.log('should show custom:', field, this.showAllCustomFields);
            return field.custom && this.showAllCustomFields;
        },

        setValue: function(values) {
            if (this.store) {
                if (Ext.isString(values)) {
                    // convert customField -> c_customField, in case called with old wsapi1.x values while in 2.x
                    var models = _.values(this.models),

                        fieldNames = _(values.split(',')).map(function(value) {
                            var modelFields = _(models).invoke('getField', value).compact().value(),
                                builtInFields = _.filter(modelFields, {custom: false}),
                                customFields = _.difference(modelFields, builtInFields);
                            return builtInFields.length === 0 ? customFields : builtInFields;
                        }).flatten().compact().pluck('name').unique().value();

                    this.callParent([fieldNames.join(',')]);
                } else {
                    this.callParent(arguments);
                }
            } else {
                this.on('fieldpickerstoreloaded', function() {
                    this.setValue(values);
                }, this);
            }
        },

        _filterApplied: function() {
            this._groupRecords(this._getRecordValue());
        },

        _loadStore: function(options) {
            var onComplete = function(options) {
                this.fireEvent('fieldpickerstoreloaded', this, this.store);
                this.store.mon(this.store, 'filterbytextinput', this._filterApplied, this);

                if (options && options.success) {
                    options.success.call(options.scope, []);
                }
            };

            Rally.data.ModelFactory.getModels({
                types: this.modelTypes,
                context: this.context || this.getStoreConfig().context,
                success: function(models) {
                    console.log('models:', models);
                    var data = this._buildStoreData(models);

                    this.models = models;

                    this.store = this._createStoreWithData(Ext.Object.getValues(data));

                    onComplete.call(this, options);
                },
                failure: function() {
                    //failure happens if we try to load a model in a context we don't have access to. E.g.,
                    //load the fields on a settings panel when scoped to a workspace we can't see.
                    this.store = this._createStoreWithData([]);
                    onComplete.call(this, options);
                },
                scope: this,
                requester: this
            });
        },

        _buildStoreData: function(models) {
            var data = {},
                excludeMappedFields = Ext.Object.getSize(models) === 1;
            Ext.Object.each(models, function(modelName, model) {
                console.log('all fiedlds for model:', model, model.getFields());

                var fields = _.filter(model.getFields(), function(field) {
                    return (!excludeMappedFields || !field.isMappedFromArtifact) &&
                        this._shouldShowField(field);
                }, this);
                var otherModels = _.difference(Ext.Object.getValues(models), [model]);

                _.each(fields, function(field) {
                    var fieldNameWithoutPrefix = field.name.replace(/^c_/, '');
                    if (!data[fieldNameWithoutPrefix]) {
                        data[fieldNameWithoutPrefix] = {
                            name: field.name,
                            displayName: Rally.ui.renderer.FieldDisplayNameRenderer.getDisplayName(field)
                        };

                        var otherModelsWithField = _.filter(otherModels, function(otherModel) {
                            return otherModel.hasField(fieldNameWithoutPrefix) && this._shouldShowField(otherModel.getField(fieldNameWithoutPrefix));
                        }, this);

                        if (otherModelsWithField.length !== otherModels.length) {
                            var modelsWithField = [model.displayName].concat(_.pluck(otherModelsWithField, 'displayName'));
                            modelsWithField = _.map(modelsWithField, function(modelWithField){
                                return modelWithField.replace('Portfolio Item ', '');
                            });
                            data[fieldNameWithoutPrefix].displayName += ' (' + modelsWithField.join(', ') + ')';
                        }
                    }
                }, this);
            }, this);
            return data;
        },

        //changed
        _shouldShowField: function(field) {
            console.log('should show field', field);
            field.hidden = false;
            return field.hidden === false &&
                (this._fieldIsInWhiteList(field) || this._shouldShowCustomField(field)) && !this._fieldIsInBlackList(field);
        },

        _createStoreWithData: function(data) {
            return Ext.create('Ext.data.Store', {
                fields: [
                    {
                        name: 'displayName',
                        sortType: Ext.data.SortTypes.asUCString
                    },
                    {
                        name: 'name'
                    }
                ],
                sorters: [
                    {
                        property: 'displayName',
                        direction: 'ASC'
                    }
                ],
                data: data,
                proxy: {
                    type: 'memory'
                }
            });
        },

        _createStoreAndExpand: function() {
            if (this.modelTypes && this.modelTypes.length) {
                this._loadStore({
                    success: function() {
                        this.expand();
                        this.fireEvent('ready', this);
                        if (Rally.BrowserTest) {
                            Rally.BrowserTest.publishComponentReady(this);
                        }
                    },
                    scope: this
                });
            }
        },

        /**
         * Notifies containers that they can call this function to have the picker reload if the context has changed.
         * @param context the new context
         */
        refreshWithNewContext: function(context) {

            if (this.getShouldRespondToScopeChange()) {
                this.refreshWithNewModelTypes(this.modelTypes, context);
            }
        },

        refreshWithNewModelTypes: function(modelTypes, context) {
            this.modelTypes = modelTypes;

            if (context) {
                this.context = context;
                this.getStoreConfig().context = context.getDataContext();
            }

            this._invokeStoreRefresh();
        },

        _invokeStoreRefresh: function() {
            if (this.picker) {
                this._loadStore({
                    success: function() {
                        this.list.bindStore(this.store);
                        this.refreshView();
                        this.fireEvent('ready', this);
                    },
                    scope: this
                });
            } else {
                this.expand();
            }
        }
    });


    Ext.define('Rally.ui.grid.ColumnBuilder', {
                   
                              
                                                         
                                               
                                                     
                                                         
                                                                       
                                                  
                                                 
                                                     
                                           
          

        statics: {
            ICON_FIELDS: ['Defects', 'Discussion', 'DisplayColor', 'Milestones', 'PredecessorsAndSuccessors', 'Tags', 'Tasks', 'TestCases'],
            ICON_HEADER_FIELDS: {
                PredecessorsAndSuccessors: 'predecessor'
            }
        },

        constructor: function () {
            this.autoAddAllModelFieldsAsColumns = true;
            this.showRowActionsColumn = true;
        },

        /**
         * Set if editing is enabled.
         * @param enableEditing {Boolean}
         * @return {Rally.ui.grid.ColumnBuilder} this
         */
        withEditingEnabled: function(enableEditing) {
            this.enableEditing = enableEditing;
            return this;
        },

        /**
         * Set if ranking is enabled.
         * @param enableRanking {Boolean}
         * @return {Rally.ui.grid.ColumnBuilder} this
         */
        withRankingEnabled: function (enableRanking) {
            this.enableRanking = enableRanking;
            return this;
        },

        withAllColumnsStateful: function (allColumnsStateful) {
            this.allColumnsStateful = allColumnsStateful;
            return this;
        },

        /**
         * Set default columns
         * @param {Array}
         * Columns to append to the default columns array.  See Rally.ui.grid.Grid#columnCfgs
         * @return {Rally.ui.grid.ColumnBuilder} this
         */
        withDefaultColumns: function (columns) {
            if (this.allColumnsStateful) {
                this.defaultColumns = _.sortBy(columns, function (column, index) {
                    var columnName = _.isObject(column) ? column.dataIndex : column;
                    return columnName === 'FormattedID' ? -1 : index;
                });
            } else {
                this.defaultColumns = columns;
            }
            return this;
        },

        /**
         * Determines if columns are sortable
         * @param {Boolean}
         * @return {Rally.ui.grid.ColumnBuilder} this
         */
        withSortableColumns: function (sortable) {
            this.sortable = sortable;
            return this;
        },

        withDisableColumnMenus: function (disableColumnMenus) {
            this.disableColumnMenus = disableColumnMenus;
            return this;
        },

        withRankColumn: function(rankColumnDataIndex) {
            this.rankColumnDataIndex = rankColumnDataIndex;
            return this;
        },

        withSummaryColumns: function(columns) {
            this.summaryColumns = Ext.Array.from(columns);
            return this;
        },

        /**
         * Add all model fields as columns automatically
         * @param {Boolean} value
         * @return {Rally.ui.grid.ColumnBuilder} this
         */
        shouldAutoAddAllModelFieldsAsColumns: function (value) {
            this.autoAddAllModelFieldsAsColumns = value;
            return this;
        },

        /**
         * Whether it should show the row actions column (gear menu)
         * @param {Boolean/Object} [value=true] False to hide, true to show with default options.
         * If an object is passed in it will be used as a custom config for the row action column.
         */
        shouldShowRowActionsColumn: function (value) {
            if (_.isObject(value)) {
                this.showRowActionsColumn = true;
                this.rowActionColumnConfig = value;
            } else {
                this.showRowActionsColumn = value;
            }
            return this;
        },

        /**
         * Do we want to reset the column flex values (widths) to their defaults?
         * @param  {Boolean} resetFlexValues True to reset the columns widths by
         *                                   reseting their flex values.
         */
        shouldResetFlexValuesToDefaults: function(resetFlexValues) {
            this.resetFlexValues = !!resetFlexValues;
            return this;
        },

        /**
         * Array of columns for which the editor should be disabled
         * @param {Array}
         * @return {Rally.ui.grid.ColumnBuilder} this
         */
        withEditorsDisabledForColumns: function (disabledEditorColumns) {
            this.disabledEditorColumns = disabledEditorColumns;
            return this;
        },

        /**
         * Flag for tree grid
         * @param {Boolean}
         * @return {Rally.ui.grid.ColumnBuilder} this
         */
        withTreeEnabled: function (treeEnabled) {
            this.treeEnabled = treeEnabled;
            return this;
        },

        /**
         * @param {Rally.app.Context} context
         */
        withContext: function(context) {
            this.context = context;
            return this;
        },

        /**
         * Init column configs to be displayed in the grid.
         * @param {Rally.data.Model}
         */
        build: function (model) {
            // Note to future people who don't fully comprehend _.compose:
            // These functions are called from the right to left, (i.e. the last function passed in is called first)
            // Also, _.flow would do the more intuitive thing, but it's not available in the version we're using (yay)
            return _.compose(
                this._setContext,
                this._resetFlexValues,
                this._stripTagsFromColumnText,
                this._augmentColumnConfigs,
                this._removeSortableFromUnsortableColumns,
                //this._removeHiddenColumns,
                this._disabledEditorColumnsAsNeeded,
                _.curry(this._alignColumns)(model),
                _.curry(this._addModelColumns)(model),
                Rally.ui.grid.GridColumnCfgTransformer.transformForModel(model),
                Rally.ui.grid.PredecessorsAndSuccessorsColumnTransformer.transformForModel(model),
                Rally.ui.grid.InvalidGridColumnCfgFilterer.filterForModel(model),
                Rally.ui.grid.RankColumnTransformer.transformForModel(model),
                this._addSummaryToColumns,
                this._transformColumnLabels,
                this._insertRankingDragHandle,
                this._insertRowActionsColumn,
                _.curry(this._insertRankColumn)(model)
            ).call(this, Ext.clone(this.defaultColumns) || []);
        },

        /**
         * Init column components to be displayed in the grid.
         * @param {Rally.data.Model}
         */
        buildCmps: function(model) {
            return _.map(this.build(model), Ext.widget);
        },

        _insertRankingDragHandle: function (columns) {
            if (this.enableRanking) {
                Ext.Array.insert(columns, 0, [
                    {xtype: this.treeEnabled ? 'rallytreerankdraghandlecolumn' : 'rallyrankdraghandlecolumn'}
                ]);
            }
            return columns;
        },

        _insertRowActionsColumn: function (columns) {
            if (this.showRowActionsColumn) {
                Ext.Array.insert(columns, 0, [
                    _.merge({
                        xtype: 'rallyrowactioncolumn'
                    }, this.rowActionColumnConfig)
                ]);
            }
            return columns;
        },

        _shouldSetColumnAlignment: function(model, column) {
            var dataIndex = column.dataIndex;
            var field = !column.align && dataIndex && model.getField && model.getField(dataIndex);
            return field && _.isFunction(field.getType);
        },

        _alignColumns: function(model, columns) {
            return _.map(columns, function (column) {
                if (this._shouldSetColumnAlignment(model, column)) {
                    var type = model.getField(column.dataIndex).getType();
                    if (type === 'boolean' || _.contains(this.self.ICON_FIELDS, column.dataIndex)) {
                        column.align = 'center';
                    } else if (_.contains(['quantity', 'decimal', 'integer', 'collection'], type)) {
                        column.align = 'right';
                    }
                }

                return column;
            }, this);
        },

        /**
         * Map column labels to something other than displayName.
         *
         * @param columns
         * @private
         */
        _transformColumnLabels: function (columns) {
            return _.map(columns, function (column) {
                if (_.isString(column) && Rally.ui.renderer.FieldDisplayNameRenderer.getDisplayName(column)) {
                    column = { dataIndex: column };
                }

                if (_.isObject(column) && column.hasOwnProperty('dataIndex')) {
                    if (this.self.ICON_HEADER_FIELDS[column.dataIndex]) {
                        column.cls = 'picto icon-' + this.self.ICON_HEADER_FIELDS[column.dataIndex];
                        column.text = '&nbsp;&nbsp;&nbsp;&nbsp;';
                    } else if (!column.hasOwnProperty('text')) {
                        this._setFieldLabelOnColumnConfig(column);
                    }
                }

                return column;
            }, this);
        },

        /**
         * @private
         * @param columns
         * Removes any columns that should be hidden
         */
        _removeHiddenColumns: function (columns) {
            return _.filter(columns, function (column) {
                return !column.modelField || !column.modelField.hidden;
            });
        },

        /**
         * @private
         * Merge auto-generated columns from model definition with existing columns
         * @param {Rally.data.Model}
         * @param {Array}
         * @return {Array} Sorted columns
         */
        _addModelColumns: function (model, alreadyAddedColumns) {
            var columns = alreadyAddedColumns;

            if (this.autoAddAllModelFieldsAsColumns) {
                var blackListedFields = Rally.ui.grid.FieldColumnFactory.getBlackListedFieldsForType(model.typePath);
                var alreadyAddedFields = _(alreadyAddedColumns).pluck('modelField').compact().valueOf(),
                    notAddedVisibleFields = _(model.getFields())
                        .filter(this._isVisibleField)
                        .difference(alreadyAddedFields).value();
                var columnsAlreadyExist = !Ext.isEmpty(alreadyAddedFields);
                var modelColumns = _(notAddedVisibleFields)
                    .map(function (field) {
                        var column = Rally.ui.grid.FieldColumnFactory.getColumnConfigFromField(field, model);
                        column.hidden = columnsAlreadyExist || _.contains(blackListedFields, field.name);
                        if (column.dataIndex) {
                            this._setFieldLabelOnColumnConfig(column);
                            if (!column.text) {
                                column.hidden = true;
                            }
                        }
                        return column;
                    }, this).value();

                // Show FormattedID and Name columns before others if they are available for the current type
                var specialColumns = ['FormattedID', 'Name'];
                modelColumns.sort(function (columnA, columnB) {
                    var specialColumnIndexA = _.indexOf(specialColumns, columnA.dataIndex);
                    var specialColumnIndexB = _.indexOf(specialColumns, columnB.dataIndex);

                    if (columnA.dataIndex && columnB.dataIndex && specialColumnIndexA !== specialColumnIndexB) {
                        if (specialColumnIndexA === -1) {
                            return 1;
                        } else if (specialColumnIndexB === -1) {
                            return -1;
                        }
                        return specialColumnIndexA < specialColumnIndexB ? -1 : 1;
                    }

                    return columnA.text < columnB.text ? -1 : columnA.text > columnB.text ? 1 : 0;
                });
                columns = columns.concat(modelColumns);
            }
            return columns;
        },

        _setFieldLabelOnColumnConfig: function (column) {
            var fieldLabel = Rally.ui.renderer.FieldDisplayNameRenderer.getDisplayName(column.dataIndex);
            if (fieldLabel) {
                column.text = fieldLabel;
            }
        },

        /**
         * @private
         * @param {Array}
         * columns
         */
        _stripTagsFromColumnText: function (columns) {
            return _.each(columns, function (column) {
                if (!column.dataIndex || !this.self.ICON_HEADER_FIELDS[column.dataIndex]) {
                    column.text = Ext.util.Format.stripTags(column.text);
                }
            }, this);
        },

        /**
         * @private
         * @param {Array}
         */
        _disabledEditorColumnsAsNeeded: function (columns) {
            _.each(columns, function (column) {
                if (!this.enableEditing || (_.isArray(this.disabledEditorColumns) && this.disabledEditorColumns.indexOf(column.dataIndex) > -1)) {
                    delete column.editor;
                    if(column.tdCls) {
                        column.tdCls = column.tdCls.replace('editable', '');
                    }
                }
            }, this);
            return columns;
        },

        _augmentColumnConfigs: function (columns) {
            return _.map(columns, function (column) {
                var newCol = Ext.applyIf(column, {
                    listeners: {
                        render: function (col) {
                            var grid = col.up('rallygrid') || col.up('rallytreegrid');
                            if (grid) {
                                Ext.Function.interceptBefore(col, 'toggleSortState', function () {
                                    var colText = col.textEl.getHTML();
                                    grid.recordAction({description: 'column sorting changed', miscData: {column: colText}});
                                    grid.recordLoadBegin({description: 'grid reload due to sort', miscData: {column: colText}});
                                    grid.on('load', function () {
                                        grid.recordLoadEnd();
                                    }, {single: true});
                                });
                            }
                        }
                    },
                    sortable: this.sortable,
                    menuDisabled: this.disableColumnMenus
                });
                if(this.sortable === false) {
                    newCol.sortable = false;
                }
                return newCol;
            }, this);
        },
        _removeSortableFromUnsortableColumns: function (columns) {
            var unsortables = ["rallytreerankdraghandlecolumn", "rallyrowactioncolumn"];
            return _.map(columns, function (column) {
                var attrDefinition = (((column || {}).modelField || {}).attributeDefinition || {});
                var isMultiValueCustomField = attrDefinition.Custom && attrDefinition.AttributeType === "COLLECTION";
                if (isMultiValueCustomField || _.contains(unsortables, column.xtype)) {
                    column.sortable = false;
                }
                return column;
            });
        },

        _isVisibleField: function (field) {
            return !field.hidden;
        },

        _insertRankColumn: function(model, columns) {
            if (model.isTask && model.isTask()) {
                columns = _.filter(columns, function(column) { return column !== 'Rank'; });
            }

            if (this.rankColumnDataIndex) {
                columns = _.filter(columns, function(column) { return column !== this.rankColumnDataIndex; }, this);
                columns.unshift({
                    xtype: 'rallyfieldcolumn',
                    text: 'Rank',
                    dataIndex: this.rankColumnDataIndex,
                    draggable: false,
                    resizable: false,
                    width: 45,
                    sortable: true
                });
            }

            return columns;
        },

        _addSummaryToColumns: function(columns) {
            return _.map(columns, function (originalColumn) {
                var updatedColumn = _.isString(originalColumn) ? { dataIndex: originalColumn } : originalColumn;
                var summaryColumn = _.find(this.summaryColumns, function (summaryColumn) {
                    return updatedColumn.dataIndex === summaryColumn.field;
                });

                return summaryColumn ? _.assign(updatedColumn, {
                    summaryRenderer: function(value) {
                        return "<span class='rollup'>" + value + " " + summaryColumn.units + "</span>";
                    },
                    summaryType:  summaryColumn.type
                }) : originalColumn;
            }, this);
        },

        _resetFlexValues: function(columns) {
            if (this.resetFlexValues) {
                _.each(columns, this._resetFlexValueForColumn);
            }
            return columns;
        },

        /**
         * Resets the flex value for a column to the default.
         * @param  {Rally.ui.cardboard.Column} column
         */
        _resetFlexValueForColumn: function(column) {
            column.flex = Rally.ui.grid.FieldColumnFactory.getDefaultFlexForField(column.dataIndex, column.flex);
        },

        _setContext: function(columns) {
            _.each(columns, function(column) {
                column.context = this.context;
            }, this);
            return columns;
        }
    });
})();