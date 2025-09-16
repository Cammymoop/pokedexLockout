
var autoConnectServer = "https://cf-shortcode-joiner.cammymoop-p.workers.dev"

var shortcodeConnection = true;

var turnUsr = "";
var turnPwd = "";

//var CON = {'optional': [{'DtlsSrtpKeyAgreement': true}]};
var sdpConstraints = {optional: []};

var CONNECTION_INFO = {
    "connectionRole": null,
    "connected": false
};
 
var peerConnection = null;
if (shortcodeConnection) {
    fetchTURNInfo();
} else {
    setupManualConnection();
}
var dataChannel = null;

var lastMessageTime = null;
// connection is considered dead after this long without a message (we try to send a heartbeat every second so this shouldn't happen)
var CONNECTION_DEAD_AFTER = 2200;

function postRtcPeerSetup() {
    // when we need to send a message to the other person, do it like this
    peerConnection.onicecandidate = function (e) {
        if (e.candidate === null) {
            CONNECTION_INFO.offerAnswer = JSON.stringify(peerConnection.localDescription);
        }

        var htmlStuff = "<input id='copyMe' type='text'> <button onclick='copyMyThingToClipboard()'>Copy to clipboard</button>";
        var includeGen2 = "";
        if (shortcodeConnection) {
            if (CONNECTION_INFO.connectionRole === "master") {
                htmlStuff = "This is the code the other person needs to connect: " + htmlStuff;
            } else {
                htmlStuff = "Paste the connection code here: <input id='remote-val' type='text'> <button id='ok-button'>Ok</button>";
            }
        } else {
            if (CONNECTION_INFO.connectionRole === "master") {
                htmlStuff = "Conection info generated.<br>Send this text to whoever is connecting and have them paste it into this page:<br>" + htmlStuff;
                htmlStuff += "<br><button id='sent-button'>Ok did it</button>";
                includeGen2 = $('#include-gen-2').prop('checked') ? "with2+" : "";
            } else if (CONNECTION_INFO.connectionRole === "not-master") {
                htmlStuff = "Connection info processed.<br>Send this text back to whoever initiated the conection.<br>" + htmlStuff;
            }
        }
        $("#setup").html(htmlStuff);
        if (CONNECTION_INFO.offerAnswer) {
            $("#copyMe").val(includeGen2 + CONNECTION_INFO.offerAnswer);
        }

        if (CONNECTION_INFO.connectionRole === "master") {
            $("#sent-button").click(function () {
                var htmlStuff = "Paste their response here: ";
                htmlStuff += "<input id='remote-val' type='text'> <button id='ok-button'>Ok</button>";
                $("#setup").html(htmlStuff);

                $("#ok-button").click(function () {
                    peerConnection.setRemoteDescription(new RTCSessionDescription(JSON.parse($('#remote-val').val())));

                    CONNECTION_INFO.connected = true;
                    connectionReady();
                });
            });
        }
    };
    peerConnection.ondatachannel = function (e) {
        var dc = e.channel || e;
        if (dc.label === "pokedex-data") {
            dataChannel = dc;
            dataChannelCallbacks(dataChannel);
        }

        CONNECTION_INFO.connected = true;
        connectionReady();
    };
}

function disableSettings() {
    $('#start-settings').find('input').prop('disabled', true);
}

$(function () {
    $("#initiate-connection").click(function () {
        disableSettings();
        //console.log("now in master mode");
        $("#initiate-connection").remove();
        $("#join-connection").remove();
        CONNECTION_INFO.connectionRole = "master";
        dataChannel = peerConnection.createDataChannel('pokedex-data', {reliable: true});
        dataChannelCallbacks(dataChannel);
        peerConnection.createOffer(sdpConstraints)
            .then((offer) => peerConnection.setLocalDescription(offer))
            .then(() => {

            })
            .catch(reason => console.error("Error creating offer: ", reason));

        $("#setup").text("Waiting...");
    });

    $("#join-connection").click(function () {
        disableSettings();
        //console.log("now in not-master mode");
        $("#initiate-connection").remove();
        $("#join-connection").remove();
        CONNECTION_INFO.connectionRole = "not-master";

        var htmlStuff = "Paste the connection info from whoever is initiating the connection here: ";
        htmlStuff += "<input id='remote-val' type='text'> <button id='ok-button'>Ok</button>";
        $("#setup").html(htmlStuff);
        $("#ok-button").click(function () {
            var textStuff = $('#remote-val').val();
            if (textStuff.substr(0, 6) === "with2+") {
                textStuff = textStuff.substr(6);
                $('#include-gen-2').prop('checked', true);
            } else {
                $('#include-gen-2').prop('checked', false);
            }
            peerConnection.setRemoteDescription(new RTCSessionDescription(JSON.parse(textStuff)));
            peerConnection.createAnswer(function (answerDesc) {
                peerConnection.setLocalDescription(answerDesc);
            }, function () {}, sdpConstraints);

            $("#setup").text("setting up...");
        });
    });
});

function dataChannelCallbacks(dc) {
    dc.onopen = function(e) { };
    dc.onmessage = function(e) {
        lastMessageTime = $.now();
        if (!CONNECTION_INFO.connected) {
            // the connection is back apparently
            goodConnection();
        }
        if (e.data.size) {
            console.log("theres a size?");
        } else {
            if (e.data.charCodeAt(0) === 2) {
                console.log("2 thing, idk what this means");
                return;
            }
            var data = JSON.parse(e.data);
            if (data.type === "sync") {
                syncHandler(data.data);
            }
            if (data.type === "poke-event") {
                receivedPokeEvent(data['event-data']);
            }
            if (data.type === "clearBoard") {
                clearBoard();
            }
        }
    };
}

function connectionReady() {
    $("#instructions").hide();
    $("#start-settings").hide();
    $("#setup").hide();

    $("#board").show();

    makeBoard();
    goodConnection();
    lastMessageTime = $.now();
    CONNECTION_INFO.heartbeat = window.setInterval(heartbeat, 1000);

    // disable context menu on right click on the board
    $("#board").on("contextmenu", function(e){
        e.preventDefault();
        return false;
    });
}

function heartbeat() {
    try {
        sendHeartbeat();
    } catch (e) {}

    if (CONNECTION_INFO.connected) {
        if ($.now() - lastMessageTime > CONNECTION_DEAD_AFTER) {
            badConnection();
        }
    }
    if (CONNECTION_INFO.connectionRole === "master") {
        boardSync();
    }
}

function sendHeartbeat() {
    if (!CONNECTION_INFO.connected) {
        console.log("Not connected!");
        return false;
    }
    dataChannel.send(JSON.stringify({"type": "heartbeat"}));
}

function sendMessage(type, data) {
    if (!CONNECTION_INFO.connected) {
        console.log("Not connected!");
        return false;
    }
    dataChannel.send(JSON.stringify({"type": type, "data": data}));
}

function sendEvent(eventData) {
    if (!CONNECTION_INFO.connected) {
        console.log("Not connected!");
        return;
    }
    dataChannel.send(JSON.stringify({"type": "poke-event", "event-data": eventData}));
}


function copyMyThingToClipboard() {
    $("#copyMe").select();
    document.execCommand("copy");
}

$("#do-manual-connection").click(function () {
    shortcodeConnection = false;
    $("#no-auto-connect").hide();
    $("#manual-connection-note").hide();
    $("#do-manual-connection").hide();
    setupManualConnection();
});


function fetchTURNInfo() {
    fetch(`${autoConnectServer}/turn-cred`)
        .then(data => {
            var rtcConfig = JSON.parse(data);
            if (!rtcConfig.ok) {
                throw new Error("Something went wrong with getting the TURN info");
            }

            var filteredConf = {
                iceServers: []
            }
            turnUsr = rtcConfig.credentials?.username;
            turnPwd = rtcConfig.credentials?.credential;
            for (var url of rtcConfig.credentials?.urls) {
                var filteredUrl = String(url).substring(0, 90);
                filteredConf.iceServers.push({
                    urls: [filteredUrl],
                    username: turnUsr,
                    credential: turnPwd
                });
            }
            peerConnection = new RTCPeerConnection(filteredConf, CON);
            postRtcPeerSetup();
        })
        .catch(reason => {
            console.error("Error fetching TURN info: ", reason);

            $("#no-auto-connect").show();
            $("#do-manual-connection").hide();
            $("#manual-connection-note").hide();

            setupManualConnection();
        });
}

function setupManualConnection() {
    const MANUAL_CFG = {'iceServers': [{'urls': "stun:stun.beam.pro"}, {'urls': "stun:stun.gmx.net"}]};
    peerConnection = new RTCPeerConnection(MANUAL_CFG);
    postRtcPeerSetup();
}