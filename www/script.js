/* globals Vue */

"use strict";

const App = Vue.createApp({
	data() {
		const channelId = window.location.pathname.substr(1);
		const channelLink = `${window.location.origin}/${channelId}`;
		const searchParams = new URLSearchParams(window.location.search);

		const name = searchParams.get("name");
		const chatEnabled = searchParams.get("chat") !== "false";
		const showHeader = searchParams.get("header") !== "false";

		return {
			channelId,
			channelLink,
			peerId: "",
			userAgent: "",
			audioDevices: [],
			videoDevices: [],
			audioEnabled: true,
			videoEnabled: true,
			showSettings: false,
			selectedAudioDeviceId: null,
			selectedVideoDeviceId: null,
			name: name ?? window.localStorage.name,
			callInitiated: false,
			localMediaStream: null,
			peers: {},
			dataChannels: {},
			showHeader,
			chatEnabled,
			chats: [],
			chatMessage: "",
			showChat: false,
			toast: [{ type: "", message: "" }],
		};
	},
	computed: {
		peersArray() {
			return Object.keys(this.peers).map((peer) => {
				let isMuted = false;
				if (this.peers[peer].stream) {
					isMuted = this.peers[peer].stream.getAudioTracks()[0].muted;
				}

				return {
					stream: this.peers[peer].stream,
					name: this.peers[peer].data.peerName,
					isTalking: this.peers[peer].data.isTalking,
					isMuted,
				};
			});
		},
	},
	methods: {
		async initiateCall() {
			if (!this.channelId) return alert("Invalid channel id");

			if (!this.name) return alert("Please enter your name");

			try {
				// Initialize media stream first
				const stream = await navigator.mediaDevices.getUserMedia({
					audio: { deviceId: this.selectedAudioDeviceId },
					video: { deviceId: this.selectedVideoDeviceId }
				});
				if (!stream) return alert("Failed to start stream")
				// Set the media stream
				this.localMediaStream = stream;

				
				// Update UI state based on actual track availability
				const audioTracks = stream.getAudioTracks();
				const videoTracks = stream.getVideoTracks();
				
				this.audioEnabled = audioTracks.length > 0 && audioTracks[0].enabled;
				this.videoEnabled = videoTracks.length > 0 && videoTracks[0].enabled;

				// Set call state first to ensure DOM elements are rendered
				this.callInitiated = true;
				
				// Wait for Vue to update the DOM
				this.$nextTick(() => {
					// Set up local video element
					const localVideo = document.getElementById('localVideo');
					if (localVideo) {
						localVideo.srcObject = stream;
						localVideo.muted = true; // Mute local video to prevent echo
						localVideo.play().catch(error => {
							console.error("Error playing local video:", error);
							this.setToast("Error playing local video", "error");
						});
					} else {
						console.error("Local video element not found");
						this.setToast("Error setting up local video", "error");
					}
					
					// Call the window.initiateCall function only after video element has been set up
					window.initiateCall();
				});
			} catch (error) {
				console.error("Error accessing media devices:", error);
				this.setToast("Error accessing camera/microphone. Please check permissions.", "error");
				this.localMediaStream = null;
				this.audioEnabled = false;
				this.videoEnabled = false;
				this.callInitiated = false;
			}
		},
		setToast(message, type = "error") {
			this.toast = { type, message, time: new Date().getTime() };
			setTimeout(() => {
				if (new Date().getTime() - this.toast.time >= 3000) {
					this.toast.message = "";
				}
			}, 3500);
		},
		copyURL() {
			navigator.clipboard.writeText(this.channelLink).then(
				() => this.setToast("Channel URL copied 👍", "success"),
				() => this.setToast("Unable to copy channel URL")
			);
		},
		toggleAudio(e) {
			e.stopPropagation();
			if (!this.localMediaStream) {
				this.setToast("Please start the call first", "error");
				return;
			}
			const audioTracks = this.localMediaStream.getAudioTracks();
			if (audioTracks.length === 0) {
				this.setToast("No audio track available", "error");
				return;
			}
			audioTracks[0].enabled = !audioTracks[0].enabled;
			this.audioEnabled = !this.audioEnabled;
		},
		toggleVideo(e) {
			e.stopPropagation();
			if (!this.localMediaStream) {
				this.setToast("Please start the call first", "error");
				return;
			}
			const videoTracks = this.localMediaStream.getVideoTracks();

			if (videoTracks.length === 0) {
				this.setToast("No video track available", "error");
				return;
			}
			videoTracks[0].enabled = !videoTracks[0].enabled;
			this.videoEnabled = !this.videoEnabled;
		},
		stopEvent(e) {
			e.preventDefault();
			e.stopPropagation();
		},
		updateName() {
			window.localStorage.name = this.name;
		},
		updateNameAndPublish() {
			window.localStorage.name = this.name;
			this.updateUserData("peerName", this.name);
		},
		updateUserData(key, value) {
			this.sendDataMessage(key, value);
		},
		formatDate(dateString) {
			const date = new Date(dateString);
			const hours = date.getHours() > 12 ? date.getHours() - 12 : date.getHours();
			return (
				(hours < 10 ? "0" + hours : hours) +
				":" +
				(date.getMinutes() < 10 ? "0" + date.getMinutes() : date.getMinutes()) +
				" " +
				(date.getHours() >= 12 ? "PM" : "AM")
			);
		},
		sanitizeString(str) {
			const tagsToReplace = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
			const replaceTag = (tag) => tagsToReplace[tag] || tag;
			const safe_tags_replace = (str) => str.replace(/[&<>]/g, replaceTag);
			return safe_tags_replace(str);
		},
		linkify(str) {
			return this.sanitizeString(str).replace(/(?:(?:https?|ftp):\/\/)?[\w/\-?=%.]+\.[\w/\-?=%]+/gi, (match) => {
				let displayURL = match.trim().replace("https://", "").replace("https://", "");
				displayURL = displayURL.length > 25 ? displayURL.substr(0, 25) + "&hellip;" : displayURL;
				const url = !/^https?:\/\//i.test(match) ? "http://" + match : match;
				return `<a href="${url}" target="_blank" class="link" rel="noopener">${displayURL}</a>`;
			});
		},
		sendChat(e) {
			e.stopPropagation();
			e.preventDefault();

			if (!this.chatMessage.length) return;

			if (Object.keys(this.peers).length > 0) {
				this.sendDataMessage("chat", this.chatMessage);
				this.chatMessage = "";
			} else {
				alert("No peers in the room");
			}
		},
		sendDataMessage(key, value) {
			const date = new Date().toISOString();
			const dataMessage = { type: key, name: this.name, peerId: this.peerId, message: value, date };

			switch (key) {
				case "chat":
					this.chats.push(dataMessage);
					break;
				default:
					break;
			}

			Object.keys(this.dataChannels).map((peer_id) => this.dataChannels[peer_id].send(JSON.stringify(dataMessage)));
		},
		setTalkingPeer(peerId, isTalking) {
			if (this.peers[peerId] && this.peers[peerId].data.isTalking !== isTalking) {
				this.peers[peerId].data.isTalking = isTalking;
			}
		},
		handleIncomingDataChannelMessage(dataMessage) {
			if (!this.peers[dataMessage.peerId]) return;
			switch (dataMessage.type) {
				case "peerName":
					this.peers[dataMessage.peerId].data.peerName = dataMessage.message;
					break;
				case "chat":
					this.showChat = true;
					this.chats.push(dataMessage);
					break;
				default:
					break;
			}
		},
	},
}).mount("#app");

const setTheme = (themeColor) => {
	if (!themeColor) return null;
	if (!/^[0-9A-F]{6}$/i.test(themeColor)) return alert("Invalid theme color");

	const textColor = parseInt(themeColor, 16) > 0xffffff / 2 ? "#000" : "#fff";

	document.documentElement.style.setProperty("--background", `#${themeColor}`);
	document.documentElement.style.setProperty("--text", textColor);
};

(async () => {
	const searchParams = new URLSearchParams(window.location.search);
	const themeColor = searchParams.get("theme");

	if (themeColor) setTheme(themeColor);

	if ("serviceWorker" in navigator) {
		navigator.serviceWorker.register("/sw.js");
	}

	try {
		// Initialize media devices
		const devices = await navigator.mediaDevices.enumerateDevices();
		App.audioDevices = devices.filter((device) => device.kind === "audioinput");
		App.videoDevices = devices.filter((device) => device.kind === "videoinput");

		// Set default device ids
		const defaultAudioDeviceId = App.audioDevices.find((device) => device.deviceId == "default")?.deviceId;
		const defaultVideoDeviceId = App.videoDevices.find((device) => device.deviceId == "default")?.deviceId;

		App.selectedAudioDeviceId = defaultAudioDeviceId ?? App.audioDevices[0]?.deviceId;
		App.selectedVideoDeviceId = defaultVideoDeviceId ?? App.videoDevices[0]?.deviceId;
	} catch (error) {
		console.error("Error initializing media devices:", error);
		App.setToast("Error initializing media devices. Please check permissions.", "error");
	}
})();
