var cdb = require('cartodb.js');
var Utils = require('cdb.Utils');
var BaseDialog = require('../../views/base_dialog/view');
var ViewFactory = require('../../view_factory');
var randomQuote = require('../../view_helpers/random_quote');

module.exports = cdb.core.View.extend({

  _CARD_WIDTH: 288,
  _CARD_HEIGHT: 170,
  _TABS_PER_ROW: 3,
  _GET_BBOX_FROM_THE_GEOM: true,

  tagName: "li",
  className: "GalleryList-item MapsList-item js-card",

  events: cdb.core.View.extendEvents({
    "click ": "_onClick"
  }),

  initialize: function() {
    this.template = cdb.templates.getTemplate('common/dialogs/pecan/card');
  },

  render: function() {
    var self = this;

    var src = this.options.url + "?api_key=" + this.options.api_key;

    var wizardName = this.model.get("visualizationType").charAt(0).toUpperCase() + this.model.get("visualizationType").slice(1);

    var null_count = +(this.model.get("null_ratio") * this.model.get("count")).toFixed(2);
    var prettyNullCount = Utils.formatNumber(null_count);

    this.$el.html(
      this.template({
      column: this.model.get("column"),
      wizard: wizardName,
      metadata: this.model.get("metadata"),
      null_count: prettyNullCount,
      weight: this.model.get("weight")
    }));

    if (this.model.get("visualizationType") === "choropleth") {
      this._addHistogram();
    }

    var img = new Image();

    img.onerror = function() {
      cdb.log.info("error loading the image for " + self.model.get("column"));
    };

    img.onload  = function() {
      self.$(".js-loader").hide();
      self.$(".js-header").append('<img class="MapCard-preview" src="' + src + '" />');
      self.$("img").show();
    };

    img.src = src;

    return this;
  },

  _onClick: function() {
    this.trigger("click", this.model, this);
  },

  _generateLayerDefinition: function(type, sql, css) {
    var template = this.options.urlTemplate;
    var api_key  = this.options.api_key;
    var maps_api_template = cdb.config.get('maps_api_template');

    var layerDefinition = {
      user_name: user_data.username,
      maps_api_template: maps_api_template,
      api_key: api_key,
      layers: [{
        type: "http",
        options: {
          urlTemplate: template,
          subdomains: [ "a", "b", "c" ]
        }
      }, {
        type: "cartodb",
        options: {
          sql: sql,
          cartocss: css,
          cartocss_version: "2.1.1"
        }
      }]
    };

    if (type === "torque"){
      layerDefinition.layers[1] = {
        type: "torque",
        options: {
          sql: sql,
          cartocss: css,
          cartocss_version: "2.1.1"
        }
      }
    }

    return layerDefinition;
  },

  _getRamp: function(dist) {
    var ramp = "inverted_red";

    if (dist === 'A' || dist === 'U') {
      ramp = "spectrum2";
    } else if (dist === 'F') {
      ramp = "red";
    } else if (dist === 'J') {
      ramp = "green";
    }

    return ramp;
  },

  _addHistogram: function() {

    var self = this;

    var data = this.model.get("cat_hist").slice(0, 7);
    var color_ramp = this._getRamp(this.model.get("dist_type"));

    var width = 70;
    var height = 11;
    var minHeight = 2;

    var x = d3.scale.ordinal()
        .rangeRoundBands([0, width], .1);

    var y = d3.scale.linear()
        .range([height, 0]);

    var xAxis = d3.svg.axis()
        .scale(x)
        .orient("bottom");

    var svg = d3.select(this.$(".js-graph")[0]).append("svg")
        .attr("width", width)
        .attr("height", height)
      .append("g");

    x.domain(data.map(function(d) { return d[0]; }));
    y.domain([0, d3.max(data, function(d) { return d[1]; })]);

    svg.append("g")
        .attr("class", "x axis")
        .attr("transform", "translate(0," + height + ")")
        .call(xAxis);

    svg.selectAll(".bar")
        .data(data)
      .enter().append("rect")
        .attr("fill", function(d, i) {
          return cdb.admin.color_ramps[color_ramp][7][i];
        })
        .attr("class", "HistogramGraph-bar")
        .attr('data-title', function(d) {
          return Utils.formatNumber(d[1]) 
        })
        .attr("x", function(d) { return x(d[0]); })
        .attr("width", 5)
        .attr("y", function(d) {
          var value = height - y(d[1]);
          var yPos = y(d[1]);
          return value < minHeight ? (height - minHeight) : yPos;
        })
        .attr("height", function(d) {
          var value = height - y(d[1]);
          return value < minHeight ? minHeight : value;
        })

    return this;
  }

});