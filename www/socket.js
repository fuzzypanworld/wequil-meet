/* globals App, io */
"use strict";

const SIGNALLING_SERVER = window.location.hostname === 'localhost' 
	? 'http://localhost:3001' 
	: 'https://wequil-meet.railway.internal';
const ICE_SERVERS = [
	{ urls: "stun:stun.l.google.com:19302" },
	{ urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
];
const VOLUME_THRESHOLD = 24;
const AUDIO_WINDOW_SIZE = 256;

let signalingSocket = null; /* our socket.io connection to our webserver */
let audioStreams = new Map(); // Holds audio stream related data for each stream

window.initiateCall = () => {
	App.userAgent = navigator.userAgent;
	
	// Initialize Socket.IO connection
	try {
		signalingSocket = io(SIGNALLING_SERVER, {
			path: '/socket.io/',
			transports: ['websocket', 'polling']
		});

		signalingSocket.on("connect", () => {
			console.log('Connected to signaling server:', SIGNALLING_SERVER);
			App.peerId = signalingSocket.id;

			const userData = { peerName: App.name, userAgent: App.userAgent };

			// Ensure we have media access before joining
			if (!App.localMediaStream) {
				setupLocalMedia(() => joinChatChannel(App.channelId, userData));
			} else {
				joinChatChannel(App.channelId, userData);
			}
		});

		signalingSocket.on("connect_error", (error) => {
			console.error('Connection error:', error);
			App.setToast('Failed to connect to signaling server');
		});

		signalingSocket.on("disconnect", () => {
			console.log('Disconnected from signaling server');
			for (let peer_id in App.peers) {
				if (App.peers[peer_id]?.rtc) {
					App.peers[peer_id].rtc.close();
				}
			}
			App.peers = {};
		});

		const joinChatChannel = (channel, userData) => {
			if (signalingSocket.connected) {
				signalingSocket.emit("join", { channel, userData });
			} else {
				console.error('Cannot join channel: Socket not connected');
				App.setToast('Connection lost. Please refresh the page.');
			}
		};

		signalingSocket.on("addPeer", (config) => {
			const peer_id = config.peer_id;
			if (peer_id in App.peers) return;

			const peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
			App.peers[peer_id] = { ...App.peers[peer_id], data: config.channel[peer_id].userData };
			App.peers[peer_id]["rtc"] = peerConnection;

			peerConnection.onicecandidate = (event) => {
				if (event.candidate) {
					signalingSocket.emit("relayICECandidate", {
						peer_id,
						ice_candidate: { sdpMLineIndex: event.candidate.sdpMLineIndex, candidate: event.candidate.candidate },
					});
				}
			};

			peerConnection.onaddstream = (event) => {
				if (!App.peers[peer_id]["data"].userAgent) return;
				App.peers[peer_id]["stream"] = event.stream;

				// Used talk detection from https://www.linkedin.com/pulse/webrtc-active-speaker-detection-nilesh-gawande/
				handleAudioStream(event.stream, peer_id);
			};

			peerConnection.ondatachannel = (event) => {
				event.channel.onmessage = (msg) => {
					try {
						App.handleIncomingDataChannelMessage(JSON.parse(msg.data));
					} catch (err) {
						console.log(err);
					}
				};
			};

			peerConnection.addStream(App.localMediaStream);
			App.dataChannels[peer_id] = peerConnection.createDataChannel("ot__data_channel");

			if (config.should_create_offer) {
				peerConnection.onnegotiationneeded = () => {
					peerConnection
						.createOffer()
						.then((localDescription) => {
							peerConnection
								.setLocalDescription(localDescription)
								.then(() => {
									signalingSocket.emit("relaySessionDescription", {
										peer_id: peer_id,
										session_description: localDescription,
									});
								})
								.catch(() => App.setToast("Offer setLocalDescription failed!"));
						})
						.catch((error) => console.log("Error sending offer: ", error));
				};
			}
		});

		signalingSocket.on("sessionDescription", (config) => {
			const peer_id = config.peer_id;
			const peer = App.peers[peer_id]["rtc"];
			const remoteDescription = config.session_description;

			const desc = new RTCSessionDescription(remoteDescription);
			peer.setRemoteDescription(
				desc,
				() => {
					if (remoteDescription.type == "offer") {
						peer.createAnswer(
							(localDescription) => {
								peer.setLocalDescription(
									localDescription,
									() =>
										signalingSocket.emit("relaySessionDescription", { peer_id, session_description: localDescription }),
									() => App.setToast("Answer setLocalDescription failed!")
								);
							},
							(error) => console.log("Error creating answer: ", error)
						);
					}
				},
				(error) => console.log("setRemoteDescription error: ", error)
			);
		});

		signalingSocket.on("iceCandidate", (config) => {
			const peer = App.peers[config.peer_id]["rtc"];
			const iceCandidate = config.ice_candidate;
			peer.addIceCandidate(new RTCIceCandidate(iceCandidate)).catch((error) => {
				console.log("Error addIceCandidate", error);
			});
		});

		signalingSocket.on("removePeer", (config) => {
			const peer_id = config.peer_id;
			if (peer_id in App.peers) {
				App.peers[peer_id]["rtc"].close();
			}
			delete App.dataChannels[peer_id];
			delete App.peers[peer_id];
			removeAudioStream(peer_id);
		});

	} catch (error) {
		console.error('Failed to initialize Socket.IO:', error);
		App.setToast('Failed to initialize connection');
	}
};

function setupLocalMedia(callback) {
	if (App.localMediaStream) {
		if (callback) callback();
		return;
	}

	navigator.mediaDevices.getUserMedia({
		audio: { deviceId: App.selectedAudioDeviceId },
		video: { deviceId: App.selectedVideoDeviceId }
	})
	.then((stream) => {
		App.localMediaStream = stream;
		if (callback) callback();
	})
	.catch((error) => {
		console.error('Media access error:', error);
		App.setToast('Unable to access camera/microphone. Please check permissions.');
	});
}

function handleAudioStream(stream, peerId) {
	// Is peer talking analyser from https://www.linkedin.com/pulse/webrtc-active-speaker-detection-nilesh-gawande/
	const audioContext = new AudioContext();
	const mediaStreamSource = audioContext.createMediaStreamSource(stream);
	const analyserNode = audioContext.createAnalyser();
	analyserNode.fftSize = AUDIO_WINDOW_SIZE;
	mediaStreamSource.connect(analyserNode);
	const bufferLength = analyserNode.frequencyBinCount;
	const dataArray = new Uint8Array(bufferLength);
	function processAudio() {
		analyserNode.getByteFrequencyData(dataArray);
		const averageVolume = dataArray.reduce((acc, val) => acc + val, 0) / bufferLength;
		App.setTalkingPeer(peerId, averageVolume > VOLUME_THRESHOLD);
		requestAnimationFrame(processAudio);
	}
	processAudio();
	audioStreams.set(peerId, { stream, analyserNode });
}

function removeAudioStream(peerId) {
	const streamData = audioStreams.get(peerId);
	if (streamData) {
		streamData.stream.getTracks().forEach((track) => track.stop());
		streamData.analyserNode.disconnect();
		audioStreams.delete(peerId);
	}
}
