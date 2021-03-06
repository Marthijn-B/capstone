//  Our websocket
var socket = io();

//server data is the round data from the server
var server_data = [];

//  Flag to control when building is appropriate
var action_in_progress = false;
var allowed_actions = {
  can_build: false
};

//  Default width/height of settlement/city
var building_dimension = 50;

var monopoly_time = 30; //seconds
var round_time = 60;  //seconds

// records whether player has had monopoly played on them
var monopoly_played = null;

//  Player tips
var show_tips = true;
var completed_tips = "";

$(document)
  .ready(function() {

    var $doc = $(document);

    //    Show the initial menu
    build_popup_start_menu();

    // Events for main start menu buttons
    $doc.on('click', '.js-start-toggle', function(e) {
      e.preventDefault();
      var active_class = $(this)
        .attr('data-target');
      build_popup_start("start_" + active_class, (active_class == "intro" ? true : false));

      //  Put the cursor in our name input
      setTimeout("set_player_focus()", 250);
    });

    //  Build lobby
    socket.on('lobby_data', function(data) {
      build_popup_lobby(data);
    });

    //  Timer sync
    socket.on('timestamp', function(data) {
        animate_timer(data);
    });

    socket.on('game_full', function() {
      $(".game_error")
        .html("The game is full, please choose another");
    });

    //  Create local player after join
    socket.on('player_id', function(data) {
      current_player = new currentPlayer(data.name, data.id, data.colour);
      setupPlayer();
      build_popup_waiting_for_players([
        ["show_message", "none"]
      ]);
    });

    // Update the waiting display as new players join the game
    socket.on('player_joined', function(data) {
      var popupData = [
        ["show_message", "block"],
        ["player_count", data.player_count],
        ["player_list", data.player_list],
        ["players_needed", data.max_players]
      ];
      build_popup_waiting_for_players(popupData);

      set_allowed_actions(false, false, false, false);
      updatePanelDisplay();
    });

    // Detect the game starting
    socket.on('game_start', function(data) {
      //  Start the game with the waiting popups
      build_popup_waiting_for_turn();

      //  Update player statuses
      if (current_game) {
        for (var i = 0; i < current_game.players.length; i++) {
          $(".other_player" + i + "_status")
            .html("<i class='fa fa-spin fa-spinner'></i>");
        }
      }

      set_allowed_actions(false, false, false, false);
      updatePanelDisplay();

      $(".score").css("visibility", "visible");
      $(".game_chat").css("right", "260px");
      $(".game_chat").show();
    });

    socket.on('game_turn', function(data) {
      server_data = data;
      resolve_game_turn(data);
    });

    socket.on('update_players_waiting', function(waiting) {
      for (var i = 0; i < waiting.length; i++) {
        current_game.players[i].turn_complete = waiting[i][1];

        $(".other_player" + i + "_status")
          .html("<i class='fa " + (waiting[i][1] ? "fa-check" : "fa-spin fa-spinner") + "'></i>");
      }
      $(".game_chat").css("right", "260px");
      $(".game_chat").show();
    });

    // Detect the game end and load up the final modal with the
    // end stats
    socket.on('game_end', function(data) {

      build_popup_end_results(data);
    });

    // Detect the game starting
    socket.on('build_board', function(data) {
      board = JSON.parse(data);

      //  Build tiles
      var _html = "";
      // set the board width
      var board_klass = document.getElementsByClassName('board');
      for(i=0; i<board_klass.length; i++) {
        board_klass[i].style.width = ((board.tiles[0].length-1) * 148)+"px";
      }

      for (var y = 0; y < board.tiles.length; y++) {
        var row = board.tiles[y];
        _html += '<div class = "board_row">';
        for (var x = 0; x < row.length; x++) {
          _html += buildTile(row[x], y, x, row.length);
        }
        _html += '</div>';
      }
      $(".board")
        .html(_html);
    });

    // Detect someone requesting the knight or cancelling the knight
    socket.on('knight_in_use', function(data) {
      if (data.knight_status === 'disable') {
        $('.cardlist .knight.card')
          .addClass('disabled');
        current_game.knight_in_use = true;
      } else {
        $('.cardlist .knight.card')
          .removeClass('disabled');
        current_game.knight_in_use = false;
      }
    });

    socket.on('update_game', function(data) {

      //  Update the local copy of the game data
      current_game = new currentGame(data);

      // DEBUG:
      console.log('current_game: ', current_game);

      turn_actions = [];

      //  Show all players score box
      setup_player_scores();

      // Update the game state panel
      updatePanelDisplay();

      //  Update all nodes on the board
      buildNodes();

      //  Insert holders for all roads
      buildRoads();

      //  Update drag and drop
      setupDragDrop();

      // ditch the greyed out tiles
      $(".hex").each(function() {
        $(this).removeClass('hex_dim');
      });

      //  Update player statuses
      for (var i = 0; i < current_game.players.length; i++) {
        $(".other_player" + i + "_status")
          .html("<i class='fa fa-spin fa-spinner'></i>");
      }
    });

    //  During the setup phase, each player waits until their
    //  turn, while the active player places a settlement and road
    var resolve_game_turn = function(data) {
      if (data.data_type === "setup_complete") {
        setup_phase = false;

        build_popup_setup_complete();

      } else if (data.data_type === 'setup_phase') {
        $(".game_chat").removeClass('game_chat_top_z');
        if (data.player !== 0) {
          //  Popup for instructions on 1st or 2nd placement
          set_allowed_actions(true, false, false, false);
          build_popup_setup_phase_your_turn(data.player);
        } else {
          //  Waiting for others to finish setup placement
          set_allowed_actions(false, false, false, false);
          build_popup_waiting_for_turn();
        }

      } else if (data.data_type === 'invalid_move') {
        //  restore player to server held player data
        current_game.player = data.player;

        //  revert current player state
        updatePanelDisplay();
        //  Details on failed moves
        alert(data.player.actions[0].action_data);

      } else if (data.data_type === 'wait_others') {
        // allow players to purchase and play dev cards this round
        reset_dev_cards_per_round()
        //  Normal round, waiting for others
        build_popup_round_waiting_for_others();

      } else if (data.data_type === 'round_turn') {
        round_turn();

      } else if (data.data_type === 'monopoly_used') {
        monopoly_played = data;
        current_game.player = data.player;
        round_turn();

      } else if (data.data_type === 'monopoly_received') {
        //  Build popup to show what was won and from who
        current_game.player = data.player;

        build_popup_monopoly_win(data);

        //  Update cards
        update_dev_cards(data);
        updatePanelDisplay();
        animate_timer(round_time);

      } else if (data.data_type === 'returned_trade_card') {
        // card received from bank trade
        update_trade_cards(data);
        updatePanelDisplay();

      } else if (data.data_type === 'player_trade') {
        console.log('TRADE DATA =', data);
        // update trade status icons and buttons
        /*
        What is received from the server currently is
        data_package.player_id
        data_package.actions[0].action_data = {
          trade_cards: new TradeCards({'sheep':3, 'grain':1}),
          wants_cards: new TradeCards({'brick':1}),
        };
        This is also stored in that players player structure on the server
        so we need to update this somewhere so that a button can be enabled
        on the upper left player box thingy, and when that is clicked, display
        a popup with those cards.
        the player structure containing the same as above is path
        player.inter_trade.wants_trade = true/false
        player.inter_trade.trade_cards = TradeCards() - simplified card struct
        player.inter_trade.wants_cards = TradeCards() - simplified card struct
        */
        if (data.actions[0].action_data.wants_trade) {
          if (data.player_id != current_player.id) {
            //  First show a bubble next to the player
            var trade_alert_html = "<div class='trade_bubble_message'>" + get_trade_message() + "</div>";
            trade_alert_html += "<div class='trade_bubble_row'>";
            trade_alert_html += " <div class='trade_bubble_button'><div class='btn btn-info btn-sm' onclick='show_player_trade(" + data.player_id + ");'>Show Me</div></div>";
            trade_alert_html += " <div class='trade_bubble_button'><div class='btn btn-info btn-sm' onclick='decline_player_trade(" + data.player_id + ");'>No Thanks!</div></div>";
            trade_alert_html += "</div>";

            //  We need to build the detail for the next popup if they click to see more info
            var give_cards = getTradeCardsHtml(data.actions[0].action_data.trade_cards, true);
            var want_cards = getTradeCardsHtml(data.actions[0].action_data.wants_cards, true);

            //  Now we tuck it inside for use later as needed
            trade_alert_html += "<div class='give_cards give_cards" + data.player_id + "'>" + give_cards + "</div>";
            trade_alert_html += "<div class='give_cards want_cards" + data.player_id + "'>" + want_cards + "</div>";

            //  We need to adjust the top for the other player avatar position
            var alert_offset = $(".other_player" + data.player_id + "_cell").offset().top;

            //  Now we show the end result
            $(".player" + data.player_id + "_bubble").html(trade_alert_html);
            $(".player" + data.player_id + "_bubble").css("top", alert_offset + "px");
            $(".player" + data.player_id + "_bubble").show();
          }
        } else {
          $(".player" + data.player_id + "_bubble").hide();
        }

      } else if (data.data_type === 'returned_player_trade') {
        // successful trade for player
        // intended to work the same as for recv from bank
        update_intertrade_cards(data);
        updatePanelDisplay();

        //  Is there a message to show?
        if (data.message) {
          alert(data.message);
        }

        //  Toggle the trade/cancel button
        $(".tradeplayer_button").show();
        $(".tradecancel_button").hide();
        current_player.trade_in_progress = false;

      } else if (data.data_type === 'cancel_player_trade') {
        $(".player" + data.player_id + "_bubble").hide();

      } else if (data.data_type === 'buy_dev_card') {

        // keep track of how many cards are purchased
        current_player.dev_cards.purchased++;
        current_player.dev_cards.recent_purchases = data.player.recent_purchases;
        update_dev_cards(data);
        updatePanelDisplay();

      } else if (data.data_type === 'return_year_of_plenty') {
        test = data;
        update_dev_cards(data);

        if (data.actions) {
          var my_cards = new Cards();
          my_cards.resource_cards = current_game.player.cards.resource_cards;
          for (var i = 0; i < data.actions.length; i++) {
            my_cards.add_cards(data.actions[i], 1);
          }
        }
        updatePanelDisplay();

      } else if (data.data_type === 'return_road_building') {
        update_dev_cards(data);
        updatePanelDisplay();

      } else if (data.data_type === 'successful_turn') {
        // wipe current turn data
        setupTurnFinished();
      } else if (data.data_type === 'force_finish_turn') {
          finish_turn();
        
      } else if (data.data_type === 'move_knight_fail') {
        alert(data.player.actions[0].action_data);
        
      } else if (data.data_type === 'move_knight_choice') {
        // Allowed to use knight after requesting and got a list of
        // locations that are valid moves
        console.log("move_knight_choice", data);
        // an array of [[x,y],..]
        let allowed = data.player.actions[0].action_data;
        for (var i = 0; i < allowed.length; i++) {
            let id = "x"+allowed[i][0]+"y"+allowed[i][1];
            console.log("Attempting to grey out ", id);
            var elem = document.getElementById(id);
            elem.classList.add("hex_dim"); //classList.remove too
        }
      } else if (data.data_type === 'robbed_player') {
        // {player_id: of the person robbed, resource: resource gained}
        console.log("robbed_player", data);
        let player_id = data.player.actions[0].action_data.player_id;
        let player_name = current_game.players[player_id].name;
        let res = data.player.actions[0].action_data.resource;
        let msg = "You robbed "+player_name+" for 1x "+res;
        alert(msg);

        var my_cards = new Cards();
        my_cards.resource_cards = current_game.player.cards.resource_cards;
        my_cards.add_cards(res, 1);
        updatePanelDisplay();
        
      } else if (data.data_type === 'robbed_by_player') {
        // {player_id: of the robber, resource: resource lost}
        console.log("robbed_by_player", data);
        let player_id = data.player.actions[0].action_data.player_id;
        let player_name = current_game.players[player_id].name;
        let res = data.player.actions[0].action_data.resource;
        let msg = "You were robbed by "+player_name+" for 1x "+res;
        alert(msg);

        var my_cards = new Cards();
        my_cards.resource_cards = current_game.player.cards.resource_cards;
        my_cards.remove_multiple_cards(res, 1);
        updatePanelDisplay();
        
      } else if (data.data_type === 'force_finish_monopoly') {
        if(current_game.player.cards.dev_cards.monopoly === 0){
          // players waiting for monopoly to finish can start turn
          round_turn();
        }else{
          if($('#monopolyPopup').is(':visible')||$('#useMonopoly').is(':visible')){
            hidePopup();
          }
        }
      } else if ('can_play_knight') {
        if (data.player.actions[0] === 'true') {
          build_popup_play_knight();
        } else {
          build_popup_restrict_dev_card_use('play');
        }
      }else {
        console.log('failed to direct data_type into an else if section');
      }
    }
    $doc.on('click', '.finishturnbutton', function(e) {
      e.preventDefault();
      finish_turn();
    });

    // Send the selected tile location to the server for knight placement
    $doc.on('click', '.hex_dim ', function(e) {
      e.preventDefault();
      let location = $(this).attr('id');
      location = location.match(/(\d+)/g);
      console.log("Selected", location);

      var action = new Action();
      action.action_type = 'move_knight_to';
      action.action_data = location;

      var data_package = new Data_package();
      data_package.data_type = 'move_knight_to';
      data_package.player_id = current_game.player.id;
      data_package.actions.push(action);
      update_server('game_update', data_package);

      let tiles = document.getElementsByClassName('hex');
      for (let i=0; i<tiles.length; i++) {
        tiles[i].classList.remove('hex_dim');
      }
    });

    /**
     * Chat Events --
     */

    // Dispatch chat message on enter press
    $doc.on('keypress', '.chat_input', function(e) {
      if (e.which != 13) return;

      var $input = $(this);
      var message = $input.val();

      socket.emit('chat_message', {
        player_id: current_player.id,
        message: message
      });

      $input.val('').focus();

      return false;
    });

    // Listen for incoming chat messages
    socket.on('chat_message', function(data) {
      var $message_panel = $('.messages');
      var message_html = "<div class=\"chat_message\"><span class=\"chat_message_name chat_player"+data.player_id+"\">"+data.name+" </span>"+data.message+"</div>";
      $message_panel.append(message_html);
    });

    /*

    New events for upcoming html templates

    */

    // Rules - click to show other cards in hand.
    $doc.on('click', '.dev_rules ', function(e) {
      e.preventDefault();
      //clear the current popup
      hidePopup();
      if ($(this)
        .hasClass('dev_year_of_plenty')) {
        build_popup_show_dev_card("year_of_plenty");
      } else if ($(this)
        .hasClass('dev_knight')) {
        build_popup_show_dev_card("knight");
      } else if ($(this)
        .hasClass('dev_monopoly')) {
        build_popup_show_dev_card("monopoly");
      } else if ($(this)
        .hasClass('dev_road_building')) {
        build_popup_show_dev_card("road_building");
      } else if ($(this)
        .hasClass('longest_road_card')) {
        build_popup_show_dev_card("longest_road");
      } else if ($(this)
        .hasClass('largest_army_card')) {
        build_popup_show_dev_card("largest_army");
      }

    });
    $doc.on('click', '.cardRules ', function(e) {
      e.preventDefault();

      // Show something if "card rules" selected
      var show_dev_card = "knight";
      //loop through and find a current development card
      if (current_game.player.cards.dev_cards.knight > 0) {
        show_dev_card = "knight";
      } else if (current_game.player.cards.dev_cards.road_building > 0) {
        show_dev_card = "road_building";
      } else if (current_game.player.cards.dev_cards.year_of_plenty > 0) {
        show_dev_card = "year_of_plenty";
      } else if (current_game.player.cards.dev_cards.monopoly > 0) {
        show_dev_card = "monopoly";
      }

      build_popup_show_dev_card(show_dev_card);
    });
    //  Trade - click on resource to give
    $doc.on('mousedown', '.card_give', function(e) {
      e.preventDefault();

      //  TODO: validate # of given resource
      if ($(this)
        .attr("class")
        .indexOf("unavailable") == -1) {
        var resource = $(this)
          .attr('data-resource');
        var image = $(".card_receive[data-resource='" + resource + "']")
          .html();
        $('.trade_give_box')
          .html(image);
      }

    });

    //  Trade - click on resource to receive
    $doc.on('mousedown', '.card_receive', function(e) {
      e.preventDefault();

      //  TODO: validate # of given resource
      var resource = $(this)
        .attr('data-resource');
      var image = $(".card_receive[data-resource='" + resource + "']")
        .html();
      $('.trade_receive_box')
        .html(image);
    });

    //  Year of Plenty - click on resource to receive
    $doc.on('mousedown', '.year_receive', function(e) {
      e.preventDefault();

      //  TODO: validate # of given resource
      var resource = $(this)
        .attr('data-resource');
      var image = $(".year_receive[data-resource='" + resource + "']")
        .html();

      var card1 = $(".year_box_card1")
        .html();
      var card2 = $(".year_box_card2")
        .html();
      if (card1.length == 0) {
        $('.year_box_card1')
          .html(image);
      } else if (card2.length == 0) {
        $('.year_box_card2')
          .html(image);
      }
    });
    //Road Building - open Road Building window
    $doc.on('click', '.road_building', function(e) {
      var recent_count = 0;
      for (var i=0; i<current_player.dev_cards.recent_purchases.length; i++) {
        if (current_player.dev_cards.recent_purchases[i] === "road_building")
          recent_count += 1;
      }
      //check to be sure no dev cards have been played yet
      if (!current_player.dev_cards.played && !current_player.road_building_used &&
          current_game.player.cards.dev_cards.road_building > recent_count) {
        build_popup_use_road_building();
      } else {
        build_popup_restrict_dev_card_use('play');
      }

    });
    $doc.on('click', '.road_building_button', function(e) {
      e.preventDefault();

      current_player.road_building_used = true;
      current_player.free_roads = 2;

      var action = new Action();
      action.action_type = 'road_building';
      action.action_result = 0;
      action.action_data = [];
      action.action_data.push("brick");
      action.action_data.push("brick");
      action.action_data.push("lumber");
      action.action_data.push("lumber");

      current_game.player.cards.resource_cards.brick++;
      current_game.player.cards.resource_cards.brick++;
      current_game.player.cards.resource_cards.lumber++;
      current_game.player.cards.resource_cards.lumber++;

      var data_package = new Data_package();
      data_package.data_type = 'road_building_used';
      data_package.player_id = current_game.player.id;
      data_package.actions.push(action);
      update_server('game_update', data_package);

      $(".road_building")
        .addClass("disabled");

      hidePopup();

      //Development card played for the turn
      dev_card_played();
    });

    // Play the Knight card
    $doc.on('click', '.cardlist .knight.card', function(e) {
      // TODO: add flag so player can click the knightcard again to cancel
      var recent_count = 0;
      for (var i=0; i<current_player.dev_cards.recent_purchases.length; i++) {
        if (current_player.dev_cards.recent_purchases[i] === "knight")
          recent_count += 1;
      }
      if (!current_player.dev_cards.played &&
          current_game.player.cards.dev_cards.knight > recent_count) {
        e.preventDefault();

        if ($(this)
          .hasClass('disabled')) {
          alert('Another player is currently using the knight card.');
          return;
        }

        var data_package = new Data_package();
        data_package.data_type = 'request_knight';
        data_package.player_id = current_game.player.id;
        data_package.knight_status = 'activate';

        // Let server know we're thinking about playing the knight
        update_server('game_update', data_package);
      } else {
        build_popup_restrict_dev_card_use('play');
      }
    });
    // Select the resource you want the knight to take
    $doc.on('click', '.play_knight', function(e) {
      e.preventDefault();

      var data_package = new Data_package();
      data_package.data_type = 'use_knight';
      data_package.player_id = current_game.player.id;
      update_server('game_update', data_package);
      updatePanelDisplay();
      current_game.player.cards.dev_cards.knight--;

      // If we've used our last knight remove the card from the players stack
      if (current_game.player.cards.dev_cards.knight === 0) {
        $('.cardlist .knight.card')
          .remove();
      }
      //Development card played for the turn
      dev_card_played();
      hidePopup();
    });
    // Cancel playing the knight card
    $doc.on('click', '.play_knight_cancel', function(e) {
      e.preventDefault();

      // Let server know knight can be freed up for other players
      var data_package = new Data_package();
      data_package.data_type = 'request_knight';
      data_package.player_id = current_game.player.id;
      data_package.knight_status = 'cancel';

      update_server('game_update', data_package);

      hidePopup();
    });

    //Monopoly - open development card rules popup
    $doc.on('click', '.monopoly', function(e) {
      //check to be sure no dev cards have been played yet
      if (!current_player.dev_cards.played) {
        build_popup_show_dev_card('monopoly');
      } else {
        build_popup_restrict_dev_card_use('play');
      }
    });

    //  Year of Plenty - clear selected resource
    $doc.on('mousedown', '.year_box_card', function(e) {
      e.preventDefault();
      $(this)
        .html("");
    });

    // Year of Plenty - open Year of Plenty window
    $doc.on('click', '.year_of_plenty', function(e) {
      var recent_count = 0;
      for (var i=0; i<current_player.dev_cards.recent_purchases.length; i++) {
        if (current_player.dev_cards.recent_purchases[i] === "year_of_plenty")
          recent_count += 1;
      }
      //check to be sure no dev cards have been played yet
      if (!current_player.dev_cards.played &&
          current_game.player.cards.dev_cards.year_of_plenty > recent_count) {
        buildPopup('round_use_year_of_plenty', false, false);
      } else {
        build_popup_restrict_dev_card_use('play');
      }
    });

    $doc.on('click', '.year_of_plenty_button', function(e) {
      e.preventDefault();
      //check to be sure no dev cards have been played yet
      if (!current_player.dev_cards.played) {
        if (this.innerHTML === 'Collect Resources') {
          var action = new Action();
          action.action_type = 'year_of_plenty';
          action.action_result = 0;
          action.action_data = [];
          var temp_data1 = $(":first-child", ".year_box_card1")
            .attr("class")
            .split('_'); //action_data {String} 'trade_sheep'
          var temp_data2 = $(":first-child", ".year_box_card2")
            .attr("class")
            .split('_'); //action_data {String} 'trade_sheep'

          action.action_data.push(temp_data1[1]);
          action.action_data.push(temp_data2[1]);

          var data_package = new Data_package();
          data_package.data_type = 'year_of_plenty_used';
          data_package.player_id = current_player.id;
          data_package.actions.push(action);
          update_server('game_update', data_package);
          hidePopup();

          //Development card played for the turn
          dev_card_played();
        } else if (this.innerHTML === 'Save for Later') {
          hidePopup();
        } else {
          console.log('Monopoly button click sent wrong click information');
        }
      } else {
        build_popup_restrict_dev_card_use('play');
      }
    });

    //  Monopoly -
    $doc.on('mousedown', '.monopoly_receive', function(e) {
      e.preventDefault();

      //  TODO: validate # of given resource
      var resource = $(this)
        .attr('data-resource');
      var image = $(".monopoly_receive[data-resource='" + resource + "']")
        .html();
      $('.monopoly_card')
        .html(image);
    });

    $doc.on('click', '.monopoly_button', function(e) {
      e.preventDefault();

      if (this.innerHTML === 'Collect Resources') {
        var action = new Action();
        action.action_type = 'monopoly';
        //action.action_result = 0;
        var temp_data = $(":first-child", ".monopoly_card")
          .attr("class")
          .split('_'); //action_data {String} 'trade_sheep'

        action.action_data = temp_data[1]; //card name
        var data_package = new Data_package();
        data_package.data_type = 'monopoly_used';
        data_package.player_id = current_game.player.id;
        data_package.actions.push(action);

        // allow only one card per turn
        dev_card_played();

        update_server('game_update', data_package);

      } else if (this.innerHTML === 'Save for Later') {
        monopoly_not_used();
        animate_timer('round');
        hidePopup();
      } else {
        console.log('Monopoly button click sent wrong click information');
      }
    });

    //  Development Card -
    $doc.on('click', '.devcard_receive', function(e) {
      e.preventDefault();

      //  TODO: validate # of given resource
      var resource = $(this)
        .attr('data-resource');
      var image = $(".devcard_receive[data-resource='" + resource + "']")
        .html();
      $('.devcard_card')
        .html(image);

    });

    //  Development Card - Purchase
    $doc.on('click', '.buybutton', function(e) {
      e.preventDefault();

      // only active in trade phase
      if (current_game.round_num > 2 && allowed_actions.can_buy) {
        // only purchase 2 cards per round
        if (current_player.dev_cards.purchased < 2) {
          console.log("----" + current_player.dev_cards.purchased);
          // check if enough cards to buy development card
          if (has_resources('dev_card')) {

            // remove resources from hand
            current_game.player.cards.resource_cards.grain--;
            current_game.player.cards.resource_cards.ore--;
            current_game.player.cards.resource_cards.sheep--;

            //current_game.player.cards.remove_cards("dev_card");
            updatePanelDisplay();
            var data_package = new Data_package();
            data_package.data_type = "buy_dev_card";
            data_package.player_id = current_game.player.id;
            update_server('game_update', data_package);
          }
        } else {
          build_popup_restrict_dev_card_use('purchase');
        }
      }
    });

    //  Player Trading - Add Give Card
    $doc.on('mousedown', '.trade_card_give', function(e) {
      e.preventDefault();
      var resource = $(this)
        .attr('data-resource');
      var resource_count = parseInt($(this)
        .attr('data-count'));
      if (resource_count > 0) {
        var card_list = $(".trade_give");
        var next_z = card_list.html()
          .length + 1;
        var new_card = '<div class="trade_card_give" style="z-index:' + (600 + next_z) +
          ';"><img src="images/card_' + resource + '_tiny.jpg"></div>';
        card_list.append(new_card);

        //  Remove resource and disable as needed
        $(".give_hidden").append(resource + ",");
        resource_count--;
        $(this)
          .attr('data-count', resource_count);
        if (resource_count < 1) {
          $(this)
            .addClass("unavailable");
        }
      }
    });
     //  Remove resources
    $doc.on('mousedown', '.trade_give', function(e) {
      e.preventDefault();

      //  Clear the selected cards
      $(".trade_give").html("");
      $(".give_hidden").html("");

      //  Rebuild the list of selectable cards
      $(".select_card_list")
        .html($(".build_hidden")
          .html());


    });

    //  Player Trading - Add Want Card
    $doc.on('mousedown', '.trade_card_want', function(e) {
      e.preventDefault();
      var resource = $(this)
      .attr('data-resource');
      var card_list = $(".trade_want");
      var next_z = card_list.html()
        .length + 1;
      var new_card = '<div class="trade_card_want" style="z-index:' + (600 + next_z) +
        ';"><img src="images/card_' + resource + '_tiny.jpg"></div>';
      card_list.append(new_card);

      $(".want_hidden").append(resource + ",");
    });

     //  Rest want resources
    $doc.on('mousedown', '.trade_want', function(e) {
      e.preventDefault();

      //  Clear the selected cards
      $(".trade_want").html("");
      $(".want_hidden").html("");
    });


    //  Build - Add Extra resource
    $doc.on('mousedown', '.build_give', function(e) {
      e.preventDefault();

      var resource = $(this)
        .attr('data-resource');
      var resource_count = parseInt($(this)
        .attr('data-count'));
      if (resource_count > 0) {
        var card_list = $(".extra_card_list");
        var next_z = card_list.html()
          .length + 1;
        var new_card = '<div class="extra_card" style="z-index:' + (600 + next_z) +
          ';"><img src="images/card_' + resource + '_small.jpg"></div>';
        card_list.append(new_card);

        //  Remove resource and disable as needed
        resource_count--;
        $(this)
          .attr('data-count', resource_count);
        if (resource_count < 1) {
          $(this)
            .addClass("disabled");
        }
      }

    });

    //  Build - Remove resources
    $doc.on('mousedown', '.extra_card_list', function(e) {
      e.preventDefault();

      //  Clear the selected cards
      $(".extra_card_list")
        .html("");
      //  Rebuild the list of selectable cards
      $(".select_card_list")
        .html($(".build_hidden")
          .html());

    });

    //close start window
    $doc.on('click', '.close-start', function(e) {
      e.preventDefault();

      hidePopup();
    });

    //  Other Player Scores/Summaries
    $doc.on('click', '.other_player_cell', function(e) {
      e.preventDefault();

      //  Get the id of the player we are viewing
      var id = $(this)
        .attr('data-id');

      //  Build the summary popup
      build_popup_player_detail(id);

    });

  });

function setupTurnFinished() {
  // wipe all current turn info (action arrays)
  turn_actions = [];
}

//  Determine what trade window(s) are to be shown
function checkTrade() {
  //  Can the player trade with the bank?
  var can_trade_bank = current_game.round_num > 2 && allowed_actions.can_trade;

  //  Can the player trade with another player?
  var anyone_still_playing = false;
  for (var i = 0; i < current_game.players.length; i++) {
    if (!current_game.players[i].turn_complete && i != current_player.id) {
      anyone_still_playing = true;
      break;
    }
  }
  var can_trade_player = anyone_still_playing && (current_game.player.cards.resource_cards.brick > 0 ||
    current_game.player.cards.resource_cards.lumber > 0 || current_game.player.cards.resource_cards.sheep > 0 ||
    current_game.player.cards.resource_cards.ore > 0 || current_game.player.cards.resource_cards.grain > 0);

  $(".tradebank_button").addClass("disabled");
  if (can_trade_bank) {
    $(".tradebank_button").removeClass("disabled");
  }
  if (current_player.trade_in_progress) {
    $(".tradeplayer_button").hide();
    $(".tradecancel_button").show();
  } else {
    $(".tradeplayer_button").show();
    $(".tradecancel_button").hide();
    $(".tradeplayer_button").addClass("disabled");
    if (can_trade_player) {
      $(".tradeplayer_button").removeClass("disabled");
    }
  }
  $(".trade_prompt").show();
}

// Open the trading window and make only tradable cards available
function openTrade() {
  //disable trade until setup complete and if tradebutton greyed out (logic in update panel)
  if (current_game.round_num > 2) {
    if (allowed_actions.can_trade) {
      action_in_progress = true;
      var resource_cards = current_game.player.cards.resource_cards;

      //basic card values
      var card_data = [
        ['brick_cards', resource_cards.brick],
        ['grain_cards', resource_cards.grain],
        ['sheep_cards', resource_cards.sheep],
        ['ore_cards', resource_cards.ore],
        ['lumber_cards', resource_cards.lumber]
      ];

      $.each(resource_cards, function(card_name, num_of_cards) {
        // recheck the value each loop to be sure JS
        // isn't reusing a variable reference.
        let this_trade = current_game.player.trading.three ? 3 : 4;

        //check whether 2:1 trade options exist
        if (current_game.player.trading[card_name]) {
          this_trade = 2;
        }

        if (num_of_cards >= this_trade) {
          card_data.push([card_name + '_status', '']);
        } else {
          card_data.push([card_name + '_status', 'unavailable']);
        }
        card_data.push([card_name + '_tradenum', this_trade]);

      });

      buildPopup('round_maritime_trade', false, false, card_data);
      set_allowed_actions(false, false, false, false);
      updatePanelDisplay();
    } else {
      buildPopup('round_no_trade', false, false);
    }
  } else {
    buildPopup('round_no_trade', false, false);
  }
}

function cancelTrade() {
  var data_package = new Data_package();
  data_package.data_type = 'cancel_player_trade';
  data_package.player_id = current_player.id;
  update_server('game_update', data_package);
  current_player.trade_in_progress = false;
  $(".trade_prompt").hide();
}

// Open the trading window and make only tradable cards available
function openInterTrade() {
  build_popup_round_domestic_trade();
}

function openPlayerTrade(player_id) {
  // displays a popup showing this players trade offer
  build_popup_round_accept_trade();
}

function acceptTrade() {

  //get id's of selected cards
  var sendCards = $('#tgb');
  var receiveCard = $('#trb');

  // make sure both cards have been set
  if (!$('#tgb')
    .is(':empty') && !$('#trb')
    .is(':empty')) {
    var data_package = new Data_package();
    data_package.data_type = 'trade_with_bank';
    data_package.player_id = current_player.id;
    var action = new Action();

    // set action_type to trade ratio (four-to-one, three-to-one....)
    action.action_type = 'trading';

    var cardsRequested = $(":first-child", sendCards)
      .attr('class')
      .replace("trade_", "");

    action.action_data = {
      cards_for_the_bank: $(":first-child", sendCards)
        .attr('class'),
      cards_from_the_bank: $(":first-child", receiveCard)
        .attr('class'),

      //set cards_for_trade to trade ratio (4,3,2)
      cards_for_trade: document.getElementById(cardsRequested + "_tradenum")
        .innerHTML
    }
    data_package.actions.push(action);

    update_server('game_update', data_package);
    hidePopup();
  } else {
    // hide trade window
    hidePopup();

    //display an error window
    alert("cant trade with that many cards");
  }
}

function initInterTrade() {
  var give_html = $('.give_hidden').html();
  var want_html = $('.want_hidden').html();

  if (give_html.length > 0 && want_html.length > 0) {
    var give_cards = new TradeCards();
    give_cards.sheep = (give_html.match(/sheep/g) || []).length;
    give_cards.ore = (give_html.match(/ore/g) || []).length;
    give_cards.lumber = (give_html.match(/lumber/g) || []).length;
    give_cards.grain = (give_html.match(/grain/g) || []).length;
    give_cards.brick = (give_html.match(/brick/g) || []).length;

    var want_cards = new TradeCards();
    want_cards.sheep = (want_html.match(/sheep/g) || []).length;
    want_cards.ore = (want_html.match(/ore/g) || []).length;
    want_cards.lumber = (want_html.match(/lumber/g) || []).length;
    want_cards.grain = (want_html.match(/grain/g) || []).length;
    want_cards.brick = (want_html.match(/brick/g) || []).length;

    var data_package = new Data_package();
    data_package.data_type = 'init_player_trade';
    data_package.player_id = current_player.id;
    var action = new Action();
    action.action_data = {
      wants_trade: true,
      trade_cards: give_cards,
      wants_cards: want_cards,
    }
    data_package.actions.push(action);
    current_player.trade_in_progress = true;

    update_server('game_update', data_package);
    hidePopup();
  }
}

function show_player_trade(player_id) {
  $(".player" + player_id + "_bubble").hide();
  build_popup_round_accept_trade(player_id);
}

function accept_player_trade(player_id) {
  // from button on popup displayed after clicking the upper left player trade button
  // tells the server the player has accepted the trade the clicked player has offered
    var data_package = new Data_package();
    data_package.data_type = 'accept_player_trade';
    data_package.player_id = current_player.id;
    var action = new Action();

    action.action_data = {
      other_id: player_id
    };

    data_package.actions.push(action);
    current_player.trade_in_progress = false;

    update_server('game_update', data_package);
    hidePopup();
}

function decline_player_trade(player_id) {
  $(".player" + player_id + "_bubble").hide();
}

function tradeFailed() {
  current_player.trade_in_progress = false;
  build_popup_trade_failed();
}

function invalidMove(data) {

  failed_actions.forEach(function(action) {

    //  populate new array with the successful actions (and copy them into turn_actions)
    var successful_actions = [];

    if (action.action_result == 0) {
      successful_actions.push(action);
    } else {
      alert("need to remove failed item artifact");
      //inform of failed actions
      //remove relevant artifact from board
      if (action.action_type === 'road') {
        //TODO: action failed dialog with 'road'
      } else if (action.action_type === 'settlement') {
        //TODO: action failed dialog with 'road'
      } else if (action.action_type === 'city') {
        //TODO: action failed dialog with 'road'
      } else {

      }
    }
    turn_actions = successful_actions;
  });
}

function checkLegitimateTurn(data_package) {
  //only two actions allowed (build road and build settlement)
  if (turn_actions.length === 2) {

    //if one is a settlement and the other is a road
    if ((turn_actions[0].action_type == 'build_settlement' || turn_actions[1].action_type ==
        'build_settlement') && (turn_actions[0].action_type == 'build_road' || turn_actions[1].action_type ==
        'build_road')) {

      update_server("game_update", data_package);
      turn_actions = [];

      //reset server data to avoid unexpected quirks
      server_data = [];
    } else {
      // TODO: wrong actions taken, clear actions and action object from turn_actions
      alert('Please place a road and a settlement');

    }
  } else {
    //TODO dialogue - Wrong number of actions, clear actions and action object from turn_actions
    alert('You must build exactly one settlement and one connecting road.');
  }
}
var update_server = function(data_type, data) {

  //data_type is a string, usually "game_update" , data is a data_package object
  socket.emit(data_type, data);
}

//  Method used to create the individual tiles when the board is first drawn
function buildTile(theTile, row, col, row_len) {
  //  We don't need the 1st water on even rows
  if ((row % 2) == 0 && (col == 0 || col == row_len)) {
    return "";
  } else {
    var newTile = "<div id='x"+col+"y"+row+"' class='hex";

    if (theTile.type == "water") {
      newTile += "_water";
    } else if (theTile.harbor.length > 0) {
      newTile += " " + theTile.type;
      newTile += " " + theTile.harbor_direction;
    } else {
      newTile += " " + theTile.type;
    }

    newTile += ((row % 2) != 0 && (col == 0) ? " hex_half" : "");
    newTile += ((row % 2) != 0 && (col == row_len-1) ? " hex_last" : "");
    newTile += "'>"
    if (theTile.type == "desert") {
      var point = getObjectPosition(col, row, 1);
      $(".robber")
        .css("left", (point[0] - 15) + "px");
      $(".robber")
        .css("top", (point[1] - 120) + "px");
      $(".robber")
        .show();
    }
    if (theTile.harbor.length > 0) {
      newTile += "<img src='images/ship_" + theTile.harbor + ".png' class='ship' />";
      newTile += "<img src='images/harbor_" + theTile.harbor_direction + ".png' class='harbor' />";
    }

    //  Set node placeholders
    if (theTile.type != "water" && theTile.type != "harbor") {
      //  We loop through all nodes on this tile
    }

    //  Set the number token if this tile has one
    if (theTile.type != "water" && theTile.type != "harbor" && theTile.type != "desert") {
      newTile += "<div class='token'><div class='number'>" + theTile.token + "<div class='dots'>" + getDots(
        theTile.token) + "</div></div></div>";
    }

    newTile += "</div>";

    return newTile;
  }
}

//  Method for updating the state of all nodes on the board
//  Iterates through the most recent game data to verify buildings
function buildNodes() {
  //  Grab a local reference of the tiles array
  var tiles = current_game.tiles;

  //  Settlements are slightly shorter
  var settlement_height = 42;

  //  Iterate through all tiles
  for (var y = 0; y < tiles.length; y++) {
    for (var x = 0; x < tiles[y].length; x++) {
      //  Next tile
      var theTile = tiles[y][x];
      if (theTile.type != "water") {
        //  Now get the nodes and determine positions
        var node_positions = theTile.associated_nodes;

        //  If there are nodes to check
        if (node_positions.length > 0) {
          //  Check each node
          for (var j = 0; j < node_positions.length; j++) {
            //  j is the position around the tile
            //  0 = bottom_right clockwise to 5 = top_right

            var node = current_game.nodes[node_positions[j]];
            var node_on_canvas = $("#node_" + node_positions[j]);
            var node_class = getNodeCSS(node);

            if (node_on_canvas.length == 0) {
              //  First we get the top x,y point of the Tile
              var point = getObjectPosition(x, y, j);

              //  Now subtract half the width/height of the city/settlement
              point[0] -= (building_dimension / 2);
              point[1] -= (node.building == "city" ? (building_dimension / 2) : (settlement_height / 2));

              //  Finally create the html based on the node properties
              $("body")
                .append("<div id='node_" + node_positions[j] + "' class='node " + node_class +
                  "' style='top:" + point[1] + "px; left:" + point[0] + "px;' data-card-list=''></div>");
            } else {
              //  The node exists on the board, update css in case it changed
              node_on_canvas.attr("class", "node " + node_class);
              if (node_class.indexOf("locked") > -1) {
                node_on_canvas.show();
              }

              //  If this is a city and is locked, make sure a settlement does not need to be released
              if (node.building == "city") {
                var settlement_to_return = $("#settlement_" + current_player.colour + "_locked_" + node.id);
                if (settlement_to_return) {
                  //  Append to appropriate pile and clear positioning
                  settlement_to_return.appendTo($(".settlementbox"));
                  //  Reset ID
                  var original_class = 'settlement_' + current_player.colour + '_open_';
                  settlement_to_return.attr('id', original_class + find_next_object_id(original_class));
                  settlement_to_return.attr('style', "");
                  settlement_to_return.attr('class', "settlement " + current_player.colour +
                    " ui-draggable ui-draggable-handle");
                  settlement_to_return.attr('data-card-list', "");
                }
              }

              //  If a companion settlement/city exists, disable it
              var dragged_node = $("#" + node.building + "_" + current_player.colour + "_pending_" + node.id);
              if (dragged_node) {
                dragged_node.attr("class", node.building + " " + current_player.colour + " disabled");
                dragged_node.attr("id", node.building + "_" + current_player.colour + "_locked_" + node.id);
              }

            }

            //  Use the bottom node as a reference when placing the robber
            if (j == 1 & theTile.robber) {

            }
          }
        }

        //  Do we need to move the robber?
        if (theTile.robber) {
          var point = getObjectPosition(x, y, 1);
          $(".robber")
            .css("left", (point[0] - 15) + "px");
          $(".robber")
            .css("top", (point[1] - 120) + "px");
          $(".robber")
            .show();
        }
      }
    }
  }
  update_object_counts();
}

// Update display figuers
function updatePanelDisplay() {
  //    If we are beyond setup, or if setup has 2 items placed, show finish button
  if (current_game) {
    // Update the resouce cards
    var resource_cards = current_game.player.cards.resource_cards;
    var $resource_box = $('.resources');
    $resource_box.find('.brickcount')
      .text(resource_cards.brick);
    $resource_box.find('.graincount')
      .text(resource_cards.grain);
    $resource_box.find('.lumbercount')
      .text(resource_cards.lumber);
    $resource_box.find('.orecount')
      .text(resource_cards.ore);
    $resource_box.find('.sheepcount')
      .text(resource_cards.sheep);

    var cards = new Cards();
    allowed_actions.can_buy = false;
    cards.resource_cards = current_game.player.cards.resource_cards;
    if (cards.available_cards("dev_card")) {
      allowed_actions.can_buy = true;
    }

    //  Determine if a trade can be made
    var current_cards = current_game.player.cards.resource_cards;
    var current_trading = current_game.player.trading;
    var base_trade_ratio = (current_trading.three ? 3 : 4);
    var can_trade = (current_cards.lumber >= base_trade_ratio || current_cards.grain >= base_trade_ratio ||
      current_cards.brick >= base_trade_ratio || current_cards.sheep >= base_trade_ratio || current_cards.ore >=
      base_trade_ratio);

    //  Now check the specific ports
    can_trade = can_trade || (current_trading.sheep && current_cards.sheep > 1);
    can_trade = can_trade || (current_trading.ore && current_cards.ore > 1);
    can_trade = can_trade || (current_trading.lumber && current_cards.lumber > 1);
    can_trade = can_trade || (current_trading.brick && current_cards.brick > 1);
    can_trade = can_trade || (current_trading.grain && current_cards.grain > 1);
    allowed_actions.can_trade = can_trade;

    // Update the score
    var score = current_game.player.score;
    var $bonuses_box = $('.bonuses');

    //if there is a change to largest army
    var army_count = document.getElementsByClassName('armycount');
    if (parseInt(army_count[0].innerHTML) === 0 && score.largest_army) {
      build_popup_largest_army(true);
      $bonuses_box.find('.armycount')
        .text(2);
    } else if (parseInt(army_count[0].innerHTML) === 2 && !score.largest_army) {
      build_popup_largest_army(false);
      $bonuses_box.find('.armycount')
        .text(0);
    }

    $bonuses_box.find('.longroadcount')
      .text(score.longest_road ? 2 : 0);
    $bonuses_box.find('.victorycount')
      .text(score.total_points);

    //  Lock down or enable actions as needed
    $(".finishturnbutton")
      .addClass("disabled");
    if (allowed_actions.can_finish) {
      $(".finishturnbutton")
        .removeClass("disabled");
    }
    $(".buybutton")
      .addClass("disabled");
    if (allowed_actions.can_buy) {
      $(".buybutton")
        .removeClass("disabled");
    }
  }
}

//  This method determines the coordinates where a settlement/city is to be drawn
function getObjectPosition(x, y, nodeIndex) {
  var board_top_offset = 30 + 5 + 26; //  Offset of board + board border + height of top row not shown
  var board_left_offset = 30 + 5 + 4; //  Offset of board + board border + width of first column not shown
  var row_variance = 48; //  Each row moves 48px up more than the previous row (cummulative)

  var tile_width = 148;
  var tile_height = 172;

  //  Use the current width/height of each tile to find the starting x/y for the tile
  //  Even rows by bumping x by 1/2 of a tile_width
  //  All rows after the first 2 need to be bumped by the variance between the rows
  var new_x = (x * tile_width) - board_left_offset - ((y % 2) == 0 ? (tile_width / 2) : 0);
  var new_y = (y * tile_height) - board_top_offset - (y > 1 ? ((y - 1) * row_variance) : 0);

  //  Nodes at 0, 1, 4 and 5 adjust to the center/right of the tile
  if (nodeIndex == 0 || nodeIndex == 5) {
    new_x += tile_width;
  }
  if (nodeIndex == 1 || nodeIndex == 4) {
    new_x += (tile_width / 2);
  }

  //  Nodes at 0, 1, 2, 3 and 5 adjust to the center/right of the tile
  if (nodeIndex == 0 || nodeIndex == 2) {
    new_y += (tile_height * 0.74);
  }
  if (nodeIndex == 3 || nodeIndex == 5) {
    new_y += (tile_height * 0.26);
  }
  if (nodeIndex == 1) {
    new_y += tile_height;
  }

  return [new_x, new_y];
}

//  This method sets the appropriate class based on the node state
function getNodeCSS(node) {
  var node_class = "buildspot";
  if (node.owner > -1) {
    node_class = node.building + " locked " + current_game.players[node.owner].colour;
  }
  return node_class;
}

//  This method determines if a node can be built on by the current player
function can_build(node, node_to_ignore) {
  var success = true;

  //  If we have a node_to_ignore, temporarily hide it's owner/building properties
  var temp_node_building = "";
  var temp_node_owner = -1;
  if (node_to_ignore) {
    temp_node_building = node_to_ignore.building;
    temp_node_owner = node_to_ignore.owner;
    node_to_ignore.building = "";
    node_to_ignore.owner = -1;
  }

  //  Make sure this is a valid spot to build
  if (node.owner === -1) {
    for (var n = 0; n < node.n_nodes.length; n++) {
      if (current_game.nodes[node.n_nodes[n]].owner > -1) {
        success = false;
        break;
      }
    }
  } else {
    success = false;
  }

  //  Now make sure we are connected by a road
  if (success) {
    if (current_game.round_num > 2) {
      success = false;
      for (var i = 0; i < node.n_roads.length; i++) {
        if (current_game.roads[node.n_roads[i]].owner == current_player.id) {
          success = true;
          break;
        }
      }
    }
  }

  //  If we have a node_to_ignore, restore it
  if (node_to_ignore) {
    node_to_ignore.building = temp_node_building;
    node_to_ignore.owner = temp_node_owner;
  }

  return success;
}

//  Method for updating the state of all roads on the board
//  Iterates through the most recent game data to verify roads
function buildRoads() {
  for (var i = 0; i < current_game.roads.length; i++) {
    var road = current_game.roads[i];

    var road_on_canvas = $("#road_" + i);
    var road_class = getRoadCSS(road);

    if (road_on_canvas.length == 0) {
      //  First we get the top x,y point of the Tile
      var point = getRoadPosition(road);

      //  We need to know the angle (30, 90, 330)
      var angle = getRoadAngle(road);

      //  Finally create the html based on the road properties
      $("body")
        .append("<div id='road_" + i + "' class='road " + road_class + " angle" + angle + "' style='top:" +
          point[1] + "px; left:" + point[0] + "px;'></div>");
    } else {
      //  The road exists on the board, update css in case it changed
      road_on_canvas.removeClass("roadspot")
        .removeClass("locked")
        .addClass(road_class);

      //  If a companion road exists, disable it
      var dragged_node = $("#road_" + current_player.colour + "_pending_" + road.id);
      if (dragged_node) {
        dragged_node.attr("class", "road " + current_player.colour + " disabled");
        dragged_node.attr("id", "road_" + current_player.colour + "_locked_" + road.id);
      }
    }
  }
}

//  Method to determine whether road on canvas can be
//  built on, is already built or is not available
function getRoadCSS(road) {
  var road_class = "roadspot";
  if (road.owner > -1) {
    road_class = "locked " + current_game.players[road.owner].colour;
  }
  return road_class;
}

//  Check nodes connected to this road to determine the
//  angle of this road
function getRoadAngle(road) {
  var node1_left = $("#node_" + road.connects[0])
    .css("left")
    .replace("px", "");
  var node2_left = $("#node_" + road.connects[1])
    .css("left")
    .replace("px", "");

  if (node1_left == node2_left) {
    return 90;
  } else {
    if (parseInt(node1_left) > parseInt(node2_left)) {
      return 30;
    } else {
      return 330;
    }
  }
}

//  This method determines the coordinates where a road is to be drawn
function getRoadPosition(road) {
  var node1_left = parseInt($("#node_" + road.connects[0])
    .css("left")
    .replace("px", ""));
  var node1_top = parseInt($("#node_" + road.connects[0])
    .css("top")
    .replace("px", ""));
  var node2_left = parseInt($("#node_" + road.connects[1])
    .css("left")
    .replace("px", ""));
  var node2_top = parseInt($("#node_" + road.connects[1])
    .css("top")
    .replace("px", ""));

  //  Angled road
  var road_width = 65;
  var road_height = 52;
  if (node1_left == node2_left) {
    //  Vertical road
    road_width = 25;
    road_height = 60;
  }

  //  Find the difference based on the size of the road
  var left_diff = (0.5 * Math.abs((node1_left - node2_left)) - (0.5 * road_width));
  var top_diff = (0.5 * Math.abs((node1_top - node2_top)) - (0.5 * road_height));

  //  Assume a 330 degree angle first
  var new_x = node1_left + (0.5 * building_dimension);
  if (node1_left == node2_left) {
    //  Vertical road (90 degrees)
    new_x = node2_left + (0.5 * building_dimension) - (0.5 * road_width);
  } else if (node1_left > node2_left) {
    //  30 degrees
    new_x = node2_left + left_diff + (0.5 * building_dimension);
  }

  //  Assume a 330 degree angle first
  var new_y = node1_top - top_diff - (0.4 * building_dimension);
  if (node1_left == node2_left) {
    //  Vertical road (90 degrees)
    new_y = (node2_top > node1_top ? node1_top : node2_top) + (0.5 * top_diff) + (0.4 * building_dimension);
  } else if (node1_top > node2_top) {
    //  30 degrees
    new_y = node2_top + top_diff + (0.4 * building_dimension);
  }

  return [new_x, new_y];
}

//  Some simple logic to see if a road can be built
function can_build_road(road, road_to_ignore, node_to_enforce) {
  var success = true;

  //  If we have a road_to_ignore, temporarily hide it's owner property
  var temp_node_owner = -1;
  if (road_to_ignore) {
    temp_node_owner = road_to_ignore.owner;
    road_to_ignore.owner = -1;
  }

  //  Grab a local reference of the nodes array
  var nodes = current_game.nodes;
  var roads = current_game.roads;

  //  Is a road already here?
  if (road.owner == -1) {
    //  If we have a node_to_enforce, we must build off it
    var is_enforced = true;
    if (node_to_enforce != null) {
      if (nodes[road.connects[0]] != node_to_enforce && nodes[road.connects[1]] != node_to_enforce) {
        is_enforced = false;
      }
    }

    if (is_enforced && node_to_enforce != null) {
      //  Do we have an adjacent building?
      if (nodes[road.connects[0]].owner != current_player.id && nodes[road.connects[1]].owner !=
        current_player.id) {
        //  No adjacent buildings, do we have an adjacent road? Check roads of connected nodes
        success = has_adjacent_road(road.connects[0]) || has_adjacent_road(road.connects[1]);
      } else {
        success = true;
      }
    } else if (node_to_enforce == null) {
      //  If we have a building of another player at one end, we need a road of ours at the other
      if (nodes[road.connects[0]].owner != current_player.id && nodes[road.connects[0]].owner > -1) {
        //  Check connect #0
        success = has_adjacent_road(road.connects[1]);
      } else if (nodes[road.connects[1]].owner != current_player.id && nodes[road.connects[1]].owner > -1) {
        //  Check connect #1
        success = has_adjacent_road(road.connects[0]);
      } else {
        //  No adjacent buildings, do we have an adjacent road? Check roads of connected nodes
        success = has_adjacent_road(road.connects[0]) || has_adjacent_road(road.connects[1]);
      }
    } else {
      success = false;
    }
  } else {
    success = false;
  }
  //  If we have a road_to_ignore, restore it
  if (road_to_ignore) {
    road_to_ignore.owner = temp_node_owner;
  }
  return success;
}
//  Helper method to check and see if one direction of a road connects is owned by current player
function has_adjacent_road(road_connect_index) {
  var nodes = current_game.nodes;
  var roads = current_game.roads;

  for (var i = 0; i < nodes[road_connect_index].n_roads.length; i++) {
    if (roads[nodes[road_connect_index].n_roads[i]].owner == current_player.id) {
      return true;
    }
  }
  return false;
}

function getDots(d) {
  if (d == 2 || d == 12) {
    return ".";
  }
  if (d == 3 || d == 11) {
    return "..";
  }
  if (d == 4 || d == 10) {
    return "...";
  }
  if (d == 5 || d == 9) {
    return "....";
  }
  if (d == 6 || d == 8) {
    return ".....";
  }
}

function validateNode(neighbors, index, nodeindex) {
  if (neighbors[index] != null) {
    if (neighbors[index].nodes != null) {
      if (neighbors[index].nodes.length > nodeindex) {
        return neighbors[index].nodes[nodeindex];
      }
    }
  }
  return null;
}

function has_resources(object_type, ignore_id) {
  var success = false;

  //  Get the current player cards
  var my_cards = new Cards();
  my_cards.resource_cards = current_game.player.cards.resource_cards;

  //  If the item is on the board, we need to temporarily add the resources for that item
  //  back into the cards for this player
  if (ignore_id && current_game.round_num > 2) {
    if (ignore_id.indexOf("_pending_") > -1) {
      var cards = $("#" + ignore_id)
        .attr("data-card-list");
      if (cards.length > 0) {
        my_cards.add_cards_from_list(cards.split(","));
      }
    }
  }

  if (object_type == "settlement") {
    //  During the setup round, assume they do
    if (current_game.round_num < 3) {
      return true;
    }
    //  Otherwise we need 1 lumber, 1 grain, 1 brick and 1 sheep
    success = my_cards.has_cards(['lumber', 'grain', 'brick', 'sheep']);
  }
  if (object_type == "road") {
    //  During the setup round, assume they do
    if (current_game.round_num < 3) {
      return true;
    }
    //  Otherwise we need 1 lumber, 1 brick
    success = my_cards.has_cards(['lumber', 'brick']);
  }
  if (object_type == "city") {
    //  Otherwise we need 2 grain and 3 ore
    success = my_cards.has_cards(['grain', 'grain', 'ore', 'ore', 'ore']);
  }
  if (object_type == "dev_card") {
    //  Otherwise we need 2 grain and 3 ore
    success = my_cards.has_cards(['ore', 'grain', 'sheep']);
  }

  //  If the item is on the board, we need to remove the resources we added earlier
  if (ignore_id) {
    if (ignore_id.indexOf("_pending_") > -1) {
      var cards = $("#" + ignore_id)
        .attr("data-card-list");
      if (cards.length > 0) {
        my_cards.remove_boost_cards(cards.split(","));
      }
    }
  }

  return success;
}

function getResourceCardsHtml() {
  var html = "";
  var resource_list = ['ore', 'brick', 'lumber', 'grain', 'sheep'];
  for (var i = 0; i < resource_list.length; i++) {
    var resource_count = current_game.player.cards.resource_cards[resource_list[i]];
    html += "<img class='build_give trade_" + resource_list[i] + (resource_count < 1 ? " disabled" : "") +
      "' data-resource='" + resource_list[i] + "' data-count='" + resource_count + "' src='images/card_" +
      resource_list[i] + "_small.jpg'>";
  }
  return html;
}

function getTradeCardsHtml(cards, show_all_cards) {
  var html = "";
  var resource_list = ['ore', 'brick', 'lumber', 'grain', 'sheep'];
  for (var i = 0; i < resource_list.length; i++) {
    var resource_count = cards[resource_list[i]];
    if (show_all_cards) {
      for (var j = 0; j < resource_count; j++) {
        html += "<img class='trade_card_float' src='images/card_" + resource_list[i] + "_small.jpg'>";
      }
    } else {
      html += "<img class='trade_card_give trade_" + resource_list[i] +
      (resource_count < 1 ? " unavailable" : "") + "' data-resource='" + resource_list[i] +
      "' data-count='" + resource_count + "' src='images/card_" + resource_list[i] + "_small.jpg'>";
    }
  }
  return html;
}

function check_failed_builds() {
  for (var i = 0; i < current_game.player.turn_data.actions.length; i++) {
    if (current_game.player.turn_data.actions[i].action_result > 0) {
      return false;
    }
  }
  return true;
}

// Checked every time "begin Round" clicked to manage monopoly actions
function monopoly_check() {
  if (monopoly_played !== null) {
    build_popup_monopoly_lose(monopoly_played);
    //  Update cards
    updatePanelDisplay();
    monopoly_played = null;
  } else {
    if($('#useMonopoly').is(':visible')){
      console.log("monopoly button visible");
      monopoly_not_used();
      animate_timer('round');
    }
    hidePopup();
  }
}

function monopoly_not_used() {
  var data_package = new Data_package();
  data_package.data_type = 'monopoly_not_used';
  data_package.player_id = current_game.player.id;
  update_server('game_update', data_package);
}

function setupPlayer() {
  //  For the first time here, create the structure
  var html = "";
  html += "        <div class='timer_box'><div id='timer_inner'></div></div>";
  html += "        <div class='row'>";
  html += "            <div class='player'><img src='images/player" + current_player.id + ".png' /></div>";
  html += "            <div class='playername'>" + current_player.name;
  html += "               <div class='playerbutton'>";
  html += "                   <div class='btn btn-info finishturnbutton disabled'>Finish Turn</div>";
  html += "               </div>";
  html += "               <div class='dice_row'>";
  html +=
    "                   <div class='dice_window'><img id='score_dice_1' src='images/dice_score.png' class='dice dice1' /></div>";
  html +=
    "                   <div class='dice_window'><img id='score_dice_2' src='images/dice_score.png' class='dice dice1' /></div>";
  html +=
    "                   <div class='robber_roll' style='display:block;'><img src='images/robber.png' width='15'></div>";
  html += "               </div>";
  html += "            </div>";
  html += "        </div>";
  html += "        <div class='resources'>";
  html += "            Resources:<br />";
  html += "            <div class='box brick'><span class='brickcount'>0</span></div>";
  html += "            <div class='box lumber'><span class='lumbercount'>0</span></div>";
  html += "            <div class='box sheep'><span class='sheepcount'>0</span></div>";
  html += "            <div class='box ore'><span class='orecount'>0</span></div>";
  html += "            <div class='box grain'><span class='graincount'>0</span></div>";
  html +=
    "            <div class='box trade'><div class='btn btn-info tradebutton' onclick='checkTrade()'>Trade</div></div>";
  html += "        </div>";
  html += "        <div class='buildings'>";
  html += "            Buildings:<br />";
  html += "            <div class='settlementbox_disable'></div>";
  html += "            <div class='settlementbox'>";
  html += "                <span class='settlementcount'>5</span>";
  for (var i = 0; i < 5; i++) {
    html += "                <div id='settlement_" + current_player.colour + "_open_" + i +
      "' class='settlement " + current_player.colour + "' ></div>";
  }
  html += "            </div>";
  html += "            <div class='citybox_disable'></div>";
  html += "            <div class='citybox'>";
  html += "                <span class='citycount'>4</span>";
  for (var i = 0; i < 4; i++) {
    html += "                <div id='city_" + current_player.colour + "_open_" + i + "' class='city " +
      current_player.colour + "' ></div>";
  }
  html += "            </div>";
  html += "            <div class='roadbox_disable'></div>";
  html += "            <div class='roadbox'>";
  html += "                <span class='roadcount'>15</span>";
  for (var i = 0; i < 15; i++) {
    html += "                <div id='road_" + current_player.colour + "_open_" + i + "' class='road " +
      current_player.colour + " angle30' ></div>";
  }
  html += "            </div>";
  html += "            <div class='infobox_disable'></div>";
  html +=
    "            <div class='infobox' onclick='build_popup_no_resources();'><img src='images/help.png' style='height:40px;' /></div>";
  html += "        </div>";
  html += "            <div class='cards'>";
  html += "                Cards:<span class='cardRules'>Card Rules</span><br />";
  html += "                <div class='cardlist'><img src='../images/nocards.png' class='no_cards' /></div>";
  html +=
    "                <div class='buy'><div class='btn btn-info buybutton disabled'>Buy Development Card</div></div>";
  html += "            </div>";
  html += "           <div class='bonuses'>";
  html += "               Bonuses:<br />";
  html += "               <div class='box bigarmy'><span class='armycount'>0</span></div>";
  html += "               <div class='box longroad'><span class='longroadcount'>0</span></div>";
  html += "               <div class='box victory'><span class='victorycount'>0</span></div>";
  html += "            </div>";

  $(".score")
    .html(html);
}

/**
 * Popup to show development cards full size with their game rules.
 *
 * @param {String} card : dev card (knight, monopoly...)
 */

function show_dev_card_info(card) {
  build_popup_show_dev_card(card);
}

function setup_player_scores() {
  var scores = "";
  for (var p = 0; p < current_game.players.length; p++) {
    if (p != current_player.id) {
      scores += '<div class="other_player_cell other_player' + current_game.players[p].id + '_cell" data-id="' + current_game.players[p].id + '">';
      scores += '    <div class="other_player_avatar"><img src="images/player' + current_game.players[p].id + '.png" /></div>';
      scores += '    <div class="other_player' + current_game.players[p].id + '_status"></div>';
      scores += '    <div class="other_player_name">' + current_game.players[p].name + '</div>';
      scores += '    <div class="other_player_score">' + current_game.players[p].points + '</div>';
      scores += '</div>';
      scores += '<div class="player' + p + '_bubble"></div>';
    }
  }

  $('.other_players')
    .html(scores);
  $('.other_players')
    .show();
}

var test = null;
function update_trade_cards(data) {
  var card_qty_lost = data.player.actions[0][0];
  var card_type_lost = data.player.actions[0][1];
  var card_qty_gain = data.player.actions[0][2];
  var card_type_gain = data.player.actions[0][3];
  
  var my_cards = new Cards();
  my_cards.resource_cards = current_game.player.cards.resource_cards;
  my_cards.remove_multiple_cards(card_type_lost, card_qty_lost);
  my_cards.add_cards(card_type_gain, card_qty_gain);
}
function update_intertrade_cards(data) {
  if (data.player.inter_trade.wants_trade) {
    var my_cards = new Cards();
    my_cards.resource_cards = current_game.player.cards.resource_cards;
    my_cards.remove_multiple_cards("brick", data.player.inter_trade.trade_cards["brick"]);
    my_cards.remove_multiple_cards("lumber", data.player.inter_trade.trade_cards["lumber"]);
    my_cards.remove_multiple_cards("ore", data.player.inter_trade.trade_cards["ore"]);
    my_cards.remove_multiple_cards("sheep", data.player.inter_trade.trade_cards["sheep"]);
    my_cards.remove_multiple_cards("grain", data.player.inter_trade.trade_cards["grain"]);

    my_cards.add_cards("brick", data.player.inter_trade.wants_cards["brick"]);
    my_cards.add_cards("lumber", data.player.inter_trade.wants_cards["lumber"]);
    my_cards.add_cards("ore", data.player.inter_trade.wants_cards["ore"]);
    my_cards.add_cards("sheep", data.player.inter_trade.wants_cards["sheep"]);
    my_cards.add_cards("grain", data.player.inter_trade.wants_cards["grain"]);
  }
}

function update_dev_cards(data) {

  var card_list = "";
  var count = data.player.cards.dev_cards.year_of_plenty;
  for (var i=0; i<count; i++) {
    var last = (i === count-1) ? "last" : "";
    card_list += "<img src='images/dev_year_of_plenty.jpg' " +"title='Year of Plenty x" +
    data.player.cards.dev_cards.year_of_plenty + "' class='year_of_plenty card " + last +
    (card_list.length == 0 ? " first" : "") + "'>";
  }
  count = data.player.cards.dev_cards.knight;
  for (var i=0; i<count; i++) {
    var last = (i === count-1) ? "last" : "";
    var disabled_class = (current_game.knight_in_use) ? ' disabled' : '';
    card_list += "<img src='images/dev_knight.jpg' " + "title='Knight x" +
    data.player.cards.dev_cards.knight + "' class='knight card " + last +
    (card_list.length == 0 ? " first" : "") + disabled_class + "'>";
  }
  count = data.player.cards.dev_cards.monopoly;
  for (var i=0; i<count; i++) {
    var last = (i === count-1) ? "last" : "";
    card_list += "<img src='images/dev_monopoly.jpg' " + "title='Monopoly x" +
    data.player.cards.dev_cards.monopoly + "' class='monopoly card " + last +
    (card_list.length == 0 ? " first" : "") + "'>";
  }
  count = data.player.cards.dev_cards.road_building;
  for (var i=0; i<count; i++) {
    var last = (i === count-1) ? "last" : "";
    card_list += "<img src='images/dev_road_building.jpg' " + "title='Road Building x" +
    data.player.cards.dev_cards.road_building + "' class='road_building card " + last +
    (card_list.length == 0 ? " first" : "") + "'>";
  }
  if (card_list === "") {
    card_list += "<img src='../images/nocards.png' class='no_cards' />";
  }
  //these are cheap and nasty but for some reason cards.count_victory_cards() fails with undefined
  // get most recent index
  let idx = data.player.recent_purchases.length - 1;
  if (data.player.recent_purchases[idx] === "chapel") {
    build_popup_victory_point_received("chapel");
  }
  if (data.player.recent_purchases[idx] === "library") {
    build_popup_victory_point_received("library");
  }
  if (data.player.recent_purchases[idx] === "market") {
    build_popup_victory_point_received("market");
  }
  if (data.player.recent_purchases[idx] === "university_of_catan") {
    build_popup_victory_point_received("university_of_catan");
  }
  if (data.player.recent_purchases[idx] === "great_hall") {
    build_popup_victory_point_received("great_hall");
  }
  $(".cardlist")
    .html(card_list);
}

//  Remove resource cards (just the base ones) from the current player
function remove_base_cards_for_item(object_type) {
  var my_cards = new Cards();
  my_cards.resource_cards = current_game.player.cards.resource_cards;
  my_cards.remove_boost_cards(my_cards.get_required_cards(object_type));
}

//  Take resources cards and tie them to the object on the canvas
function take_resources(object_id, card_list) {
  var my_cards = new Cards();
  my_cards.resource_cards = current_game.player.cards.resource_cards;
  my_cards.remove_boost_cards(card_list);
  $("#" + object_id)
    .attr("data-card-list", card_list);
}

//  Restore resource cards the current object used to the current player
function return_resources(object_id) {
  var cards = $("#" + object_id)
    .attr("data-card-list");
  if (cards) {
    if (cards.length > 0) {
      var my_cards = new Cards();
      my_cards.resource_cards = current_game.player.cards.resource_cards;
      my_cards.add_cards_from_list(cards.split(","));
    }
    $("#" + object_id)
      .attr("data-card-list", "");
  }
}

// Only one card can be played per turn
function dev_card_played() {
  current_player.dev_cards.played = true;
}

// At end of turn reset the dev_card.played and dev_card.purchased variables
// Re-enable the knight card
function reset_dev_cards_per_round() {
  console.log(current_player);
  current_player.dev_cards.played = false;
  current_player.dev_cards.purchased = 0;
  current_player.dev_cards.recent_purchases = [];

  $('.cardlist .knight.card')
    .removeClass('disabled');
  current_game.knight_in_use = false;
}

//  Set the focus for the player name input
function set_player_focus() {
  $("#player-input")
    .focus();
}
//  Submit the name when enter is used
function player_input_on_enter(e) {
  var key = e.keyCode || e.which;
  if (key == 13) {
    setTimeout("show_games()", 500);
    return false;
  }
  return true;
}
//  Start a new game
function start_new_game(game_size) {

  $('.game_button').addClass('disabled');

  var name = $('#player-input')
    .val();
  if (name === '') {
    $(".game_error")
      .html("Please enter a name for your game");
    $('.game_button').removeClass('disabled');
    return;
  }

  socket.emit('new_game', {
    name: current_player.name,
    game_name: name
  }, game_size);
}
//  Show game list or new game option
function show_games() {
  var name = $('#player-input')
    .val();
  if (name == '') {
    $(".player_error")
      .html("Please enter your name");
    return;
  }

  current_player = new currentPlayer(name, -1, '');
  socket.emit('display_lobby');
}
//  Join an existing game
function join_game(game_id) {
  socket.emit('join_request', {
    name: current_player.name,
    game_id: game_id
  });
}

//  Adjust what is allowed or not (build, buy, trade, finish round)
function set_allowed_actions(can_build, can_buy, can_trade, can_finish) {
  allowed_actions.can_build = can_build;
  allowed_actions.can_buy = can_buy;
  allowed_actions.can_trade = can_trade;
  allowed_actions.can_finish = can_finish;
}

function finish_turn(){
  var data_package = new Data_package();
  if (current_game.round_num < 3) {
    if (turn_actions.length != 2) {
      alert("Please place a settlement and road.");
      return false;
    }
    data_package.data_type = "setup_phase";
  } else if (current_player.road_building_used) {
    if (current_player.free_roads == 0) {
      data_package.data_type = "turn_complete";
      current_player.road_building_used = false;
    } else {
      alert("Please place both your free roads.");
      return false;
    }
  } else {
    data_package.data_type = "turn_complete";
  }

  if (!allowed_actions.can_finish) {
    return false;
  }
  build_popup_round_waiting_for_others();
  $(".game_chat").addClass('game_chat_top_z');

  //  Hide the reminder
  hide_tip();

  //  Adjust trade stuff
  current_player.trade_in_progress = false;
  $('.trade_prompt').hide();
  $(".tradeplayer_button").show();
  $(".tradecancel_button").hide();

  data_package.player_id = current_player.id;
  data_package.actions = turn_actions;
  update_server("game_update", data_package);

  set_allowed_actions(false, false, false, false);
  updatePanelDisplay();
}

function animate_timer(timer_data){
    $('#timer_inner').stop();
    $('#timer_inner').animate({
      width: '100%'
    }, 300, 'linear', function(){
      $('#timer_inner').animate({
        width: '0%'
      }, (timer_data.timer_expires-Date.now()-300), 'linear'
    )});
    console.log(timer_data.timer_expires);
    console.log(Date.now());
    console.log('timer set to: '+ (timer_data.timer_expires - Date.now() - 300));
}

function get_trade_message() {
  var r = Math.floor(Math.random() * 6) + 1;
  if (r == 1)
    return "Hey! Wanna trade?";
  if (r == 1)
    return "Psst. I have a sweet deal for you...";
  if (r == 1)
    return "You will not want to pass this deal up...";
  if (r == 1)
    return "I need your help...please!";
  if (r == 1)
    return "Want to trade some resources?";

  return "Want to swap some cards?";
}


function round_turn(){
  $(".game_chat").removeClass('game_chat_top_z');
  if (current_game.round_num === 2) {
    //  On the first round, we need to show the setup phase results
    //build_popup_setup_complete();
    setup_phase = false;
  } else {
    //  First, check to see if any previous builds failed
    var has_failed = !check_failed_builds();
    if (has_failed) {
      //  Show the details of the failed builds
      build_popup_failed_moves();

    } else {
      //  Otherwise, we start with the dice popup
      build_popup_round_roll_results();
    }
    // allow players to purchase and play dev cards this round
    reset_dev_cards_per_round()

    set_allowed_actions(true, false, false, true);
    updatePanelDisplay();
  }
}
function doLog(m) {
  $(".log")
    .append(m + "<br />");
}

