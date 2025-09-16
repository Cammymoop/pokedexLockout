
var autoConnectServer = "https://cf-shortcode-joiner.cammymoop-p.workers.dev"

var shortcodeConnection = true;
var heartbeatCantSendLogged = false;

var turnUsr = "";
var turnPwd = "";

//var CON = {'optional': [{'DtlsSrtpKeyAgreement': true}]};
//var sdpConstraints = {optional: []};

var CONNECTION_INFO = {
    "offer": null,
    "doneGathering": false,
    "connectionRole": null,
    "connected": false,
    "mainDataChannelReady": false
};

var whenDoneGathering = null;
 
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
    if (shortcodeConnection) {
        postRtcPeerSetupAuto();
        return;
    }
    // when we need to send a message to the other person, do it like this
    peerConnection.onicecandidate = function (e) {
        if (e.candidate === null) {
            CONNECTION_INFO.offerAnswer = JSON.stringify(peerConnection.localDescription);
        }

        var htmlStuff = "<input id='copyMe' type='text'> <button onclick='copyMyThingToClipboard()'>Copy to clipboard</button>";
        var extraOptions = "";
        if (CONNECTION_INFO.connectionRole === "master") {
            htmlStuff = "Conection info generated.<br>Send this text to whoever is connecting and have them paste it into this page:<br>" + htmlStuff;
            htmlStuff += "<br><button id='sent-button'>Ok did it</button>";
            extraOptions = $('#include-gen-2').prop('checked') ? "with2+" : "";
            extraOptions += $('#shuffle-order').prop('checked') ? "shuffle+" : "";
        } else if (CONNECTION_INFO.connectionRole === "not-master") {
            htmlStuff = "Connection info processed.<br>Send this text back to whoever initiated the conection.<br>" + htmlStuff;
        }
        $("#setup").html(htmlStuff);
        if (CONNECTION_INFO.offerAnswer) {
            $("#copyMe").val(extraOptions + CONNECTION_INFO.offerAnswer);
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

function postRtcPeerSetupAuto() {
    peerConnection.onicegatheringstatechange = function (e) {
        if (peerConnection.iceGatheringState === "complete") {
            console.log("Ice gathering complete");
            CONNECTION_INFO.doneGathering = true;
            if (whenDoneGathering !== null) {
                whenDoneGathering();
            }
        }
    };
    peerConnection.ondatachannel = function (e) {
        var dc = e.channel;
        console.log("Data channel opened " + dc.label);
        if (dc.label === "pokedex-data") {
            dataChannel = dc;
            dataChannelCallbacks(dataChannel);
            CONNECTION_INFO.mainDataChannelReady = true;
        }
    };
}

function startAutoIceDiscoveryTimeout() {
    // If gathering isn't done by 2 minutes, just send anyway
    setTimeout(function () {
        if (!CONNECTION_INFO.doneGathering) {
            CONNECTION_INFO.doneGathering = true;
            console.log("Done gathering timed out, forcing it to be true");
            if (whenDoneGathering !== null) {
                whenDoneGathering();
            }
        }
    }, 1000 * 60 * 0.5);
}

function autoCreateOffer() {
    setupDataChannel();
    peerConnection.onicecandidate = function (e) {
        console.log("ice candidate", e);
    };
    return peerConnection.createOffer().then(offer => {
        console.log("created offer", offer);
        CONNECTION_INFO.offer = offer
        return peerConnection.setLocalDescription(offer).then(() => {
            console.log("set local description");
            if (!CONNECTION_INFO.doneGathering) {
            startAutoIceDiscoveryTimeout();
                console.log("waiting for ice gathering before sending offer");
                whenDoneGathering = () => autoSendOffer();
            } else {
                console.log("already done gathering, sending offer");
                autoSendOffer();
            }
        });
    });
}

function autoSendOffer() {
    CONNECTION_INFO.offer = peerConnection.localDescription;
    console.log("sending offer", CONNECTION_INFO.offer);
    CONNECTION_INFO.offer.extraInfo = "";
    if ($('#include-gen-2').prop('checked')) {
        CONNECTION_INFO.offer.extraInfo += "with2+";
    }
    if ($('#shuffle-order').prop('checked')) {
        CONNECTION_INFO.offer.extraInfo += "shuffle+";
    }

    fetch(`${autoConnectServer}/create`, {
        method: "POST",
        body: JSON.stringify({"sdp": CONNECTION_INFO.offer.sdp, "type": CONNECTION_INFO.offer.type, "extraInfo": CONNECTION_INFO.offer.extraInfo})
    })
    .then(async response => {
        if (response.status !== 200) {
            $("#auto-connection-status").text("Error connecting, please try again later, or use the manual connection.");
            throw new Error("Error sending offer: " + response.status);
        }
        CONNECTION_INFO.connectionCode = await response.text();
        awaitAnswer();
    })
    .catch(reason => console.error("Error sending offer: ", reason));
}

function awaitAnswer() {
    $("#auto-connection-status").text(
        "Your connection code is: "
        + CONNECTION_INFO.connectionCode
        + " Waiting for someone to join..."
    );

    var pollForAnswer = async function(lastResponse) {
        if (lastResponse !== null) {
            if (lastResponse.status === 404) {
                $("#auto-connection-status").text("Connection code expired, please create a new one.");
                return;
            } else if (lastResponse.status === 200) {
                var responseData = await lastResponse.json();
                if (responseData.ready) {
                    console.log("Someone connected!");
                    console.log("response answer", JSON.parse(responseData.answer));
                    peerConnection.setRemoteDescription(JSON.parse(responseData.answer)).then(() => {
                        CONNECTION_INFO.connected = true;
                    });

                    CONNECTION_INFO.connected = true;
                    connectionReady();

                    return;
                }
            }
        }
        setTimeout(() => {
            fetch(`${autoConnectServer}/answer/${CONNECTION_INFO.connectionCode}`).then(lastResponse => pollForAnswer(lastResponse))
        }, 1000);
    }
    
    fetch(`${autoConnectServer}/answer/${CONNECTION_INFO.connectionCode}`).then(lastResponse => pollForAnswer(lastResponse));
}

function autoAskForConnectionCode() {
    $("#setup").html("Connection code: <input id='remote-val' type='text'><button id='auto-connect-button'>Connect</button>");
    $("#auto-connect-button").click(autoConnectWithCode);
}

function autoConnectWithCode() {
    CONNECTION_INFO.connectionCode = $('#remote-val').val();
    $('#setup').hide();
    $("#auto-connection-status").show();
    $("#auto-connection-status").text("Connecting with code " + CONNECTION_INFO.connectionCode + "...");

    fetch(`${autoConnectServer}/offer/${CONNECTION_INFO.connectionCode}`).then(async response => {
        if (response.status === 404) {
            $("#auto-connection-status").text("No connection found for code " + CONNECTION_INFO.connectionCode);
            $("#setup").show();
            return;
        }

        offer = await response.json();
        CONNECTION_INFO.offer = offer;
        if (offer.extraInfo) {
            var extraOptions = offer.extraInfo.split("+");
            if (extraOptions.includes("with2")) {
                includeGen2 = true;
                $('#include-gen-2').prop('checked', true);
            } else {
                includeGen2 = false;
                $('#include-gen-2').prop('checked', false);
            }
            if (extraOptions.includes("shuffle")) {
                $('#shuffle-order').prop('checked', true);
            } else {
                $('#shuffle-order').prop('checked', false);
            }
        }
        console.log(offer);
        peerConnection.setRemoteDescription(offer)
        .then(() => peerConnection.createAnswer())
        .then(answer => {
            CONNECTION_INFO.answer = answer;
            peerConnection.setLocalDescription(answer)
        })
        .then(() => {
            if (!CONNECTION_INFO.doneGathering) {
                startAutoIceDiscoveryTimeout();
                $("#auto-connection-status").text("Waiting for connection to settle...");
                whenDoneGathering = () => autoSendAnswer();
            } else {
                autoSendAnswer();
            }
        });
    });
}

function autoSendAnswer() {
    CONNECTION_INFO.answer = peerConnection.localDescription;
    $("#auto-connection-status").text("Connecting with code " + CONNECTION_INFO.connectionCode + ", Waiting for confirmation...");
    fetch(`${autoConnectServer}/answer/${CONNECTION_INFO.connectionCode}`, {
        method: "POST",
        body: JSON.stringify(CONNECTION_INFO.answer)
    }).then(async response => {
        if (response.status !== 200) {
            $("#auto-connection-status").text("Error confirming connection: " + response.status);
            return;
        }
        $("#auto-connection-status").text("Connection confirmed!");
        CONNECTION_INFO.connected = true;
        connectionReady();
    });
}

function disableSettings() {
    $('#start-settings').find('input').prop('disabled', true);
}

function setupDataChannel() {
    console.log("trying to add main data channel");
    dataChannel = peerConnection.createDataChannel('pokedex-data', {reliable: true});
    dataChannelCallbacks(dataChannel);
}

$(function () {
    $("#initiate-connection").click(function () {
        $("#manual-connection").hide();
        disableSettings();
        //console.log("now in master mode");
        $("#initiate-connection").remove();
        $("#join-connection").remove();
        CONNECTION_INFO.connectionRole = "master";
        if (shortcodeConnection) {
            autoCreateOffer();
            $("#auto-connection-status").show();
            $("#auto-connection-status").text("Connecting...");
        } else {
            peerConnection.createOffer()
                .then((offer) => peerConnection.setLocalDescription(offer))
                .catch(reason => console.error("Error creating offer: ", reason));
        }
    });

    $("#join-connection").click(function () {
        $("#manual-connection").hide();
        disableSettings();
        //console.log("now in not-master mode");
        $("#initiate-connection").remove();
        $("#join-connection").remove();
        CONNECTION_INFO.connectionRole = "not-master";

        if (shortcodeConnection) {
            autoAskForConnectionCode();
        } else {
            var htmlStuff = "Paste the connection info from whoever is initiating the connection here: ";
            htmlStuff += "<input id='remote-val' type='text'> <button id='ok-button'>Ok</button>";
            $("#setup").html(htmlStuff);
            $("#ok-button").click(function () {
                var textStuff = $('#remote-val').val();
                if (textStuff.substr(0, 6) === "with2+") {
                    $('#include-gen-2').prop('checked', true);
                    textStuff = textStuff.substr(6);
                } else {
                    $('#include-gen-2').prop('checked', false);
                }
                if (textStuff.substr(0, 8) === "shuffle+") {
                    $('#shuffle-order').prop('checked', true);
                    textStuff = textStuff.substr(8);
                } else {
                    $('#shuffle-order').prop('checked', false);
                }
                peerConnection.setRemoteDescription(new RTCSessionDescription(JSON.parse(textStuff)));
                peerConnection.createAnswer(function (answerDesc) {
                    peerConnection.setLocalDescription(answerDesc);
                }, function () {});

                $("#setup").text("setting up...");
            });
        }
    });
});

function dataChannelCallbacks(dc) {
    dc.onopen = function(e) { 
        console.log("main data channel opened");
        CONNECTION_INFO.mainDataChannelReady = true;
        firstGame();
    };
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
            if (data.type === "shuffledOrder") {
                shuffledOrderReceived(data.data);
            }
        }
    };
}

function connectionReady() {
    $("#instructions").hide();
    $("#start-settings").hide();
    $("#setup").hide();
    $("#auto-connection-status").hide();

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
    if (!CONNECTION_INFO.mainDataChannelReady) {
        return;
    }
    try {
        sendHeartbeat();
    } catch (e) {
        console.error("Error sending heartbeat: ", e);
    }

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
        if (!heartbeatCantSendLogged) {
            heartbeatCantSendLogged = true;
            console.log("Heartbeat: Not connected!");
        }
        return false;
    } else {
        heartbeatCantSendLogged = false;
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
    $("#manual-connection").hide();
    setupManualConnection();
});


function fetchTURNInfo() {
    fetch(`${autoConnectServer}/turn-cred`)
        .then(response => response.json())
        .then(rtcConfig => {
            if (!rtcConfig.ok) {
                console.log(rtcConfig);
                throw new Error("Something went wrong with getting the TURN info. rtcConfig:");
            }

            var filteredConf = {
                iceServers: [],
                //bundlePolicy: "max-bundle",
            }
            turnUsr = rtcConfig.credentials.iceServers?.username;
            turnPwd = rtcConfig.credentials.iceServers?.credential;
            for (var url of rtcConfig.credentials?.iceServers?.urls) {
                var filteredUrl = String(url).substring(0, 90);
                filteredConf.iceServers.push({
                    urls: [filteredUrl],
                    username: turnUsr,
                    credential: turnPwd
                });
            }
            peerConnection = new RTCPeerConnection(filteredConf);
            postRtcPeerSetup();
        })
        .catch(reason => {
            console.error("Error fetching TURN info: ", reason);

            $("#no-auto-connect").show();
            $("#manual-connection").hide();

            setupManualConnection();
        });
}

function setupManualConnection() {
    const MANUAL_CFG = {'iceServers': [{'urls': "stun:stun.beam.pro"}, {'urls': "stun:stun.gmx.net"}]};
    peerConnection = new RTCPeerConnection(MANUAL_CFG);
    postRtcPeerSetup();
}