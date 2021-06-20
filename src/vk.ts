// first we import a few needed things again
import {
	PuppetBridge,
	IRemoteUser,
	IReceiveParams,
	IRemoteRoom,
	IMessageEvent,
	IFileEvent,
	MessageDeduplicator,
	Log,
	ISendingUser,
} from "mx-puppet-bridge";

import { VK, MessageContext, Context, AttachmentType, MessageForwardsCollection } from "vk-io";
import { userInfo } from "os";
import { runInThisContext } from "vm";
import { lookup } from "dns";
import { Converter } from "showdown";
import { MessagesMessageAttachment } from "vk-io/lib/api/schemas/objects";
import { ElementFlags } from "typescript";

// here we create our log instance
const log = new Log("VKPuppet:vk");

// this interface is to hold all data on a single puppet
interface IEchoPuppet {
	// this is usually a client class that connects to the remote protocol
	// as we just echo back, unneeded in our case
	client: VK;
	// tslint:disable-next-line: no-any
	data: any; // and let's keep a copy of the data associated with a puppet
}

// we can hold multiple puppets at once...
interface IEchoPuppets {
	[puppetId: number]: IEchoPuppet;
}

export class VkPuppet {
	private puppets: IEchoPuppets = {};
	private converter: Converter = new Converter({
		simplifiedAutoLink: true,
		excludeTrailingPunctuationFromURLs: true,
		strikethrough: true,
		simpleLineBreaks: true,
		requireSpaceBeforeHeadingText: true,
	});
	constructor(
		private puppet: PuppetBridge,
	) { }

	public async getSendParams(puppetId: number, peerId: number, senderId: number, eventId?: string | undefined):
		Promise<IReceiveParams> {
		// we will use this function internally to create the send parameters
		// needed to send a message, a file, reactions, ... to matrix
		// log.info(`Creating send params for ${peerId}...`);

		return {
			room: await this.getRemoteRoom(puppetId, peerId),
			user: await this.getRemoteUser(puppetId, senderId),
			eventId,
		};
	}

	public async getRemoteUser(puppetId: number, userId: number): Promise<IRemoteUser> {
		const p = this.puppets[puppetId];
		// log.debug("User id:", userId, userId.toString());
		if (userId < 0) {
			const info = await p.client.api.groups.getById({ group_id: Math.abs(userId).toString() });
			const response: IRemoteUser = {
				puppetId,
				userId: userId.toString(),
				name: info[0].name,
				avatarUrl: info[0].photo_200,
				externalUrl: `https://vk.com/${info[0].screen_name}`,
			};
			return response;
		} else {
			const info = await p.client.api.users.get({ user_ids: userId.toString(), fields: ["photo_max", "screen_name"] });
			const response: IRemoteUser = {
				puppetId,
				userId: userId.toString(),
				name: `${info[0].first_name} ${info[0].last_name}`,
				avatarUrl: info[0].photo_max,
				externalUrl: `https://vk.com/${info[0].screen_name}`,
			};
			return response;
		}
	}

	public async getRemoteRoom(puppetId: number, peerId: number): Promise<IRemoteRoom> {
		const p = this.puppets[puppetId];
		const info = await p.client.api.messages.getConversationsById({ peer_ids: peerId, fields: ["photo_max"] });
		let response: IRemoteRoom;
		switch (info.items[0]?.peer.type || "chat") {
			case "user":
				// tslint:disable-next-line: no-shadowed-variable
				const userInfo = await p.client.api.users.get({ user_ids: info.items[0].peer.id, fields: ["photo_max"] });
				response = {
					puppetId,
					roomId: peerId.toString(),
					name: `${userInfo[0].first_name} ${userInfo[0].last_name}`,
					avatarUrl: userInfo[0].photo_max,
					isDirect: true,
					externalUrl: `https://vk.com/id${info.items[0].peer.id}}`,
				};
				break;

			case "chat":
				response = {
					puppetId,
					roomId: peerId.toString(),
					name: info.items[0]?.chat_settings.title || `VK chat №${(peerId - 2000000000).toString()}`,
					topic: info.count === 0 ? "To recieve chat name and avatar, puppet needs admin rights on VK side" : null,
					avatarUrl: info.items[0]?.chat_settings.photo?.photo_200,
				};
				break;

			case "group":
				const groupInfo = await p.client.api.groups.getById({ group_id: Math.abs(info.items[0].peer.id).toString() });
				response = {
					puppetId,
					roomId: peerId.toString(),
					name: groupInfo[0].name || peerId.toString(),
					avatarUrl: groupInfo[0]?.photo_200,
					externalUrl: `https://vk.com/${groupInfo[0].screen_name}`,
				};
				break;

			default:
				response = {
					puppetId,
					roomId: peerId.toString(),
					name: peerId.toString(),
					// avatarUrl: info.items['chat_settings']['photo_200'],
				};
				break;
		}
		return response;
	}

	// tslint:disable-next-line: no-any
	public async newPuppet(puppetId: number, data: any) {
		// this is called when we need to create a new puppet
		// the puppetId is the ID associated with that puppet and the data its data
		if (this.puppets[puppetId]) {
			// the puppet somehow already exists, delete it first
			await this.deletePuppet(puppetId);
		}
		// usually we create a client class of some sorts to the remote protocol
		// and listen to incoming messages from it
		try {
			const client = new VK({ token: data.token, apiLimit: 20 });
			log.debug("Trying to init listener with", data.token);

			client.updates.on("message_new", async (context) => {
				try {
					log.info("Recieved something!");
					await this.handleVkMessage(puppetId, context);
				} catch (err) {
					log.error("Error handling vk message event", err.error || err.body || err);
				}
			});
			client.updates.on("message_edit", async (context) => {
				try {
					log.info("Edit recieved!");
					await this.handleVkEdit(puppetId, context);
				} catch (err) {
					log.error("Error handling vk message event", err.error || err.body || err);
				}
			});
			client.updates.on("message_typing_state", async (context) => {
				if (context.isUser) {
					const params = await this.getSendParams(puppetId, context.fromId, context.fromId);
					await this.puppet.setUserTyping(params, context.isTyping);
				} else {
					const params = await this.getSendParams(puppetId, 2000000000 + (context?.chatId ?? 0), context.fromId);
					await this.puppet.setUserTyping(params, context.isTyping);
				}
			});
			try {
				const linkedGroupInfo = await client.api.groups.getById({});
				log.info("Got group token");
				data.isUserToken = false;
				data.username = linkedGroupInfo[0].name;
				data.id = linkedGroupInfo[0].id;
			} catch (err) {
				log.info("Got user token");
				data.isUserToken = true;
				const linkedUserInfo = await client.api.account.getProfileInfo({});
				data.username = `${linkedUserInfo.first_name} ${linkedUserInfo.last_name}`;
				data.id = linkedUserInfo.id;
			}
			this.puppets[puppetId] = {
				client,
				data,
			};
			await this.puppet.setUserId(puppetId, data.id);
			await this.puppet.setPuppetData(puppetId, data);
			try {
				await client.updates.start();
				await this.puppet.sendStatusMessage(puppetId, "Connected!");
			} catch (err) {
				await this.puppet.sendStatusMessage(puppetId, `Connection failed! ${err}`);
				log.error("Failed to initialize update listener", err);
			}
		} catch (err) {
			await this.puppet.sendStatusMessage(puppetId, `Connection failed! ${err}`);
		}
	}

	public async deletePuppet(puppetId: number) {
		// this is called when we need to delte a puppet
		const p = this.puppets[puppetId];
		if (!p) {
			// puppet doesn't exist, nothing to do
			return;
		}
		await p.client.updates.stop();
		delete this.puppets[puppetId]; // and finally delete our local copy
	}

	//////////////////////////
	// Matrix -> VK section //
	//////////////////////////

	// tslint:disable-next-line: no-any
	public async handleMatrixMessage(room: IRemoteRoom, data: IMessageEvent, asUser: ISendingUser | null, event: any) {
		// this is called every time we receive a message from matrix and need to
		// forward it to the remote protocol.

		// first we check if the puppet exists
		const p = this.puppets[room.puppetId];
		if (!p) {
			return;
		}

		if (asUser) {
			const MAX_NAME_LENGTH = 80;
			const displayname = (new TextEncoder().encode(asUser.displayname));
			asUser.displayname = (new TextDecoder().decode(displayname.slice(0, MAX_NAME_LENGTH)));
		}
		// usually you'd send it here to the remote protocol via the client object
		try {
			const response = await p.client.api.messages.send({
				peer_ids: Number(room.roomId),
				message: asUser ? `${asUser.displayname}: ${data.body}` : data.body,
				random_id: new Date().getTime(),
			});
			await this.puppet.eventSync.insert(room, data.eventId!,
				p.data.isUserToken ? response[0]["message_id"].toString() : response[0]["conversation_message_id"].toString());
		} catch (err) {
			log.error("Error sending to vk", err.error || err.body || err);
		}
	}

	public async handleMatrixEdit(room: IRemoteRoom, eventId: string, data: IMessageEvent, asUser: ISendingUser | null) {
		const p = this.puppets[room.puppetId];
		if (!p) {
			return;
		}

		if (asUser) {
			const MAX_NAME_LENGTH = 80;
			const displayname = (new TextEncoder().encode(asUser.displayname));
			asUser.displayname = (new TextDecoder().decode(displayname.slice(0, MAX_NAME_LENGTH)));
		}
		// usually you'd send it here to the remote protocol via the client object
		try {
			const response = await p.client.api.messages.edit({
				peer_id: Number(room.roomId),
				conversation_message_id: p.data.isUserToken ? undefined : Number(eventId),
				message_id: p.data.isUserToken ? Number(eventId) : undefined,
				message: asUser ? `${asUser.displayname}: ${data.body}` : data.body,
				random_id: new Date().getTime(),
			});
			log.info("SYNC Matrix edit", response);
			await this.puppet.eventSync.insert(room, data.eventId!, response.toString());
		} catch (err) {
			log.error("Error sending edit to vk", err.error || err.body || err);
		}
	}

	public async handleMatrixRedact(room: IRemoteRoom, eventId: string, asUser: ISendingUser | null) {
		const p = this.puppets[room.puppetId];
		if (!p) {
			return;
		}

		if (asUser) {
			const MAX_NAME_LENGTH = 80;
			const displayname = (new TextEncoder().encode(asUser.displayname));
			asUser.displayname = (new TextDecoder().decode(displayname.slice(0, MAX_NAME_LENGTH)));
		}

		try {
			p.data.isUserToken ? await p.client.api.messages.delete({
				spam: 0,
				delete_for_all: 1,
				message_ids: Number(eventId),
			})
				: await this.handleMatrixEdit(room, eventId, { body: "[ДАННЫЕ УДАЛЕНЫ]", eventId }, asUser);
		} catch (err) {
			log.error("Error sending edit to vk", err.error || err.body || err);
		}
	}

	public async handleMatrixReply(
		room: IRemoteRoom,
		eventId: string,
		data: IMessageEvent,
		asUser: ISendingUser | null,
		// tslint:disable-next-line: no-any
		event: any,
	) {
		const p = this.puppets[room.puppetId];
		if (!p) {
			return;
		}

		if (asUser) {
			const MAX_NAME_LENGTH = 80;
			const displayname = (new TextEncoder().encode(asUser.displayname));
			asUser.displayname = (new TextDecoder().decode(displayname.slice(0, MAX_NAME_LENGTH)));
		}

		try {
			const response = await p.client.api.messages.send({
				peer_ids: Number(room.roomId),
				message: asUser ? `${asUser.displayname}:  ${await this.stripReply(data.body)}` : await this.stripReply(data.body),
				random_id: new Date().getTime(),
				forward: p.data.isUserToken ? undefined : `{"peer_id":${Number(room.roomId)},"conversation_message_ids":${Number(eventId)},"is_reply": true}`,
				reply_to: p.data.isUserToken ? Number(eventId) : undefined,
			});
			await this.puppet.eventSync.insert(room, data.eventId!,
				p.data.isUserToken ? response[0]["message_id"].toString() : response[0]["conversation_message_id"].toString());
		} catch (err) {
			log.error("Error sending to vk", err.error || err.body || err);
		}
	}

	public async handleMatrixImage(
		room: IRemoteRoom,
		data: IFileEvent,
		asUser: ISendingUser | null,
		// tslint:disable-next-line: no-any
		event: any,
	) {
		const p = this.puppets[room.puppetId];
		if (!p) {
			return;
		}
		const MAXFILESIZE = 50000000;
		const size = data.info ? data.info.size || 0 : 0;

		if (asUser) {
			const MAX_NAME_LENGTH = 80;
			const displayname = (new TextEncoder().encode(asUser.displayname));
			asUser.displayname = (new TextDecoder().decode(displayname.slice(0, MAX_NAME_LENGTH)));
		}

		if (size < MAXFILESIZE) {
			try {
				const attachment = await p.client.upload.messagePhoto({
					peer_id: Number(room.roomId),
					source: {
						value: data.url,
					},
				});
				const response = await p.client.api.messages.send({
					peer_ids: Number(room.roomId),
					random_id: new Date().getTime(),
					message: asUser ? `${asUser.displayname} sent a photo:` : undefined,
					attachment: [`photo${attachment.ownerId}_${attachment.id}`],
				});
				await this.puppet.eventSync.insert(room, data.eventId!,
					p.data.isUserToken ? response[0]["message_id"].toString() : response[0]["conversation_message_id"].toString());
			} catch (err) {
				log.error("Error sending to vk", err.error || err.body || err);
			}
		} else {
			try {
				const response = await p.client.api.messages.send({
					peer_id: Number(room.roomId),
					message: `File ${data.filename} was sent, but it is too big for VK. You may download it there:\n${data.url}`,
					random_id: new Date().getTime(),
				});
				await this.puppet.eventSync.insert(room, data.eventId!, response.toString());
			} catch (err) {
				log.error("Error sending to vk", err.error || err.body || err);
			}
		}
	}

	public async handleMatrixFile(
		room: IRemoteRoom,
		data: IFileEvent,
		asUser: ISendingUser | null,
		// tslint:disable-next-line: no-any
		event: any,
	) {
		const p = this.puppets[room.puppetId];
		if (!p) {
			return;
		}
		const MAXFILESIZE = 50000000;
		const size = data.info ? data.info.size || 0 : 0;

		if (size < MAXFILESIZE) {
			try {
				const attachment = await p.client.upload.messageDocument({
					peer_id: Number(room.roomId),
					source: {
						value: data.url,
						filename: data.filename,
					},
				});
				const response = await p.client.api.messages.send({
					peer_id: Number(room.roomId),
					random_id: new Date().getTime(),
					message: asUser ? `${asUser.displayname} sent a file:` : undefined,
					attachment: [`doc${attachment.ownerId}_${attachment.id}`],
				});
				await this.puppet.eventSync.insert(room, data.eventId!, response.toString());
			} catch (err) {
				try {
					const response = await p.client.api.messages.send({
						peer_ids: Number(room.roomId),
						message: `File ${data.filename} was sent, but VK refused to recieve it. You may download it there:\n${data.url}`,
						random_id: new Date().getTime(),
					});
					await this.puppet.eventSync.insert(room, data.eventId!,
						p.data.isUserToken ? response[0]["message_id"].toString() : response[0]["conversation_message_id"].toString());
				} catch (err) {
					log.error("Error sending to vk", err.error || err.body || err);
				}
			}
		} else {
			try {
				const response = await p.client.api.messages.send({
					peer_ids: Number(room.roomId),
					message: `File ${data.filename} was sent, but it is too big for VK. You may download it there:\n${data.url}`,
					random_id: new Date().getTime(),
				});
				await this.puppet.eventSync.insert(room, data.eventId!,
					p.data.isUserToken ? response[0]["message_id"].toString() : response[0]["conversation_message_id"].toString());
			} catch (err) {
				log.error("Error sending to vk", err.error || err.body || err);
			}
		}
	}

	// Never called on my server for some reason, but
	// if being called, should work
	public async handleMatrixTyping(
		room: IRemoteRoom,
		typing: boolean,
		asUser: ISendingUser | null,
		event: any,
	) {
		if (typing) {
			const p = this.puppets[room.puppetId];
			if (!p) {
				return null;
			}
			try {
				const response = await p.client.api.messages.setActivity({
					peer_id: Number(room.roomId),
					type: "typing",
				});
			} catch (err) {
				log.error("Error sending typing presence to vk", err.error || err.body || err);
			}
		}
	}

	public async createRoom(room: IRemoteRoom): Promise<IRemoteRoom | null> {
		const p = this.puppets[room.puppetId];
		if (!p) {
			return null;
		}
		log.info(`Received create request for channel update puppetId=${room.puppetId} roomId=${room.roomId}`);

		return await this.getRemoteRoom(room.puppetId, Number(room.roomId));
	}

	//////////////////////////
	// VK -> Matrix section //
	//////////////////////////

	public attachedImagesSizeComparator(photo_1: MessagesMessageAttachment, photo_2: MessagesMessageAttachment): Boolean {
		// Biggest image will be first one we will get
		let sum_size_1 = photo_1['width'] + photo_1['height'];
		let sum_size_2 = photo_2['width'] + photo_2['height'];
		return sum_size_1 > sum_size_2;
	};

	public async handleVkMessage(puppetId: number, context: MessageContext) {
		const p = this.puppets[puppetId];
		if (!p) {
			return;
		}
		log.debug("Received new message!", context);
		if (context.isOutbox) {
			return; // Deduping
		}

		const params = await this.getSendParams(puppetId, context.peerId, context.senderId,
			p.data.isUserToken ? context.id.toString() : context.conversationMessageId?.toString() || context.id.toString());

		if (context.hasText || context.hasForwards) {
			let msgText: string = context.text || "";
			if (context.hasForwards) {
				msgText = await this.appendForwards(puppetId, msgText, context.forwards);
			}
			if (context.hasReplyMessage) {
				if (this.puppet.eventSync.getMatrix(params.room, context.replyMessage!.id.toString())) {
					const opts: IMessageEvent = {
						body: msgText || "Attachment",
						formattedBody: this.converter.makeHtml(msgText),
					};
					// We got referenced message in room, using matrix reply
					await this.puppet.sendReply(params, context.replyMessage!.id.toString(), opts);
				} else {
					// Using a fallback
					const opts: IMessageEvent = {
						body: await this.prependReply(
							puppetId, msgText || "",
							context.replyMessage?.text || "",
							context.senderId.toString(),
						),
					};
					await this.puppet.sendMessage(params, opts);
				}
			} else {
				const opts: IMessageEvent = {
					body: msgText || "Attachment",
					formattedBody: this.converter.makeHtml(msgText),
				};
				await this.puppet.sendMessage(params, opts);
			}
		}
		if (context.hasAttachments()) {
			const attachments = p.data.isUserToken
				? (await p.client.api.messages.getById({ message_ids: context.id })).items[0].attachments!
				: context.attachments;

			for (const f of attachments) {
				switch (f.type) {
					case AttachmentType.PHOTO:
						try {
							if (p.data.isUserToken) {
								// VK API is weird. Very weird.
								let imagesFromBiggestToSmallest = f["photo"]["sizes"].sort(this.attachedImagesSizeComparator);
								let url: string = imagesFromBiggestToSmallest[0]['url'] || "";

								if (url === "") {
									log.error(`Image not found in ${f["photo"]}`);
								};
								log.debug(`images: ${imagesFromBiggestToSmallest}`)
								await this.puppet.sendFileDetect(params, url);
							} else {
								await this.puppet.sendFileDetect(params, f["largeSizeUrl"]);
							}
						} catch (err) {
							const opts: IMessageEvent = {
								body: `Image was sent: ${f["largeSizeUrl"]}`,
							};
							await this.puppet.sendMessage(params, opts);
						}
						break;

					case AttachmentType.STICKER:
						try {
							p.data.isUserToken ? await this.puppet.sendFileDetect(params, f["sticker"]["images_with_background"][4]["url"])
								: await this.puppet.sendFileDetect(params, f["imagesWithBackground"][4]["url"]);
						} catch (err) {
							const opts: IMessageEvent = {
								body: `Sticker was sent: ${f["imagesWithBackground"][4]["url"]}`,
							};
							await this.puppet.sendMessage(params, opts);
						}
						break;

					case AttachmentType.AUDIO_MESSAGE:
						try {
							await this.puppet.sendAudio(params, f["oggUrl"]);
						} catch (err) {
							const opts: IMessageEvent = {
								body: `Audio message was sent: ${f["url"]}`,
							};
							await this.puppet.sendMessage(params, opts);
						}
						break;

					case AttachmentType.AUDIO:
						try {
							await this.puppet.sendAudio(params, f["url"]);
						} catch (err) {
							const opts: IMessageEvent = {
								body: `Music was sent: ${f["title"]} by ${f["artist"]} ${f["url"]}`,
							};
							await this.puppet.sendMessage(params, opts);
						}
						break;

					case AttachmentType.DOCUMENT:
						try {
							p.data.isUserToken ? await this.puppet.sendFileDetect(params, f["doc"]["url"], f["doc"]["title"])
								: await this.puppet.sendFileDetect(params, f["url"], f["title"]);
						} catch (err) {
							const opts: IMessageEvent = {
								body: `Document was sent: ${f["url"]}`,
							};
							await this.puppet.sendMessage(params, opts);
						}
						break;

					case AttachmentType.LINK:
						await this.puppet.sendMessage(params, {
							body: `Link was sent: ${f["url"]}`,
						});
						break;

					case AttachmentType.WALL:
						await this.puppet.sendMessage(params, {
							body: await this.renderWallPost(puppetId, f),
						});
						break;

					case AttachmentType.WALL_REPLY:
						await this.puppet.sendMessage(params, {
							body: await this.renderWallPost(puppetId, f),
						});
						break;

					default:
						await this.puppet.sendMessage(params, {
							body: `Unhandled attachment of type ${f.type}`,
						});
						break;
				}
			}
		}
	}

	public async handleVkEdit(puppetId: number, context: MessageContext) {
		const p = this.puppets[puppetId];
		if (!p) {
			return;
		}
		log.info(context);
		// As VK always sends edit as outbox, we won't work with any edits from groups
		if (!p.data.isUserToken && context.senderType === "group") {
			return; // Deduping
		}

		// With users it works ok
		if (p.data.isUserToken && context.isOutbox === true) {
			return; // Deduping
		}

		const params = await this.getSendParams(puppetId, context.peerId, context.senderId, context.id.toString());
		if (context.hasText) {
			const opts: IMessageEvent = {
				body: context.text || "Attachment",
			};
			await this.puppet.sendEdit(params, context.id.toString(), opts);
		}
	}

	////////////////
	// Formatters //
	////////////////

	public async prependReply(puppetId: number, body: string, reply: string, userid: string) {
		const user = await this.getRemoteUser(puppetId, Number(userid));
		const replySplitted = reply.split("\n");
		let formatted: string = `> <${user.name}>\n`;
		replySplitted.forEach((element) => {
			formatted += `> ${element}\n`;
		});
		formatted += `\n\n${body}`;
		return formatted;
	}

	public async stripReply(body: string) {
		// tslint:disable-next-line: prefer-const
		let splitted = body.split("\n");
		let isCitate = true;
		while (isCitate) {
			if (splitted[0].startsWith(">")) {
				splitted.splice(0, 1);
			} else {
				isCitate = false;
			}
		}
		return (splitted.join("\n").trim());
	}

	public async appendForwards(puppetId: number, body: string, forwards: MessageForwardsCollection) {
		let formatted = `${body}\n`;
		for (const f of forwards) {
			const user = await this.getRemoteUser(puppetId, Number(f.senderId));
			formatted += `> <[${user.name}](${user.externalUrl})>\n`;
			f.text?.split("\n").forEach((element) => {
				formatted += `> ${element}\n`;
			});
			if (f.hasAttachments()) {
				f.attachments.forEach((attachment) => {
					switch (attachment.type) {
						case AttachmentType.PHOTO:
							formatted += `> 🖼️ [Photo](${attachment["largeSizeUrl"]})\n`;
							break;
						case AttachmentType.STICKER:
							formatted += `> 🖼️ [Sticker](${attachment["imagesWithBackground"][4]["url"]})\n`;
							break;
						case AttachmentType.AUDIO_MESSAGE:
							formatted += `> 🗣️ [Audio message](${attachment["oggUrl"]})\n`;
							break;
						case AttachmentType.DOCUMENT:
							formatted += `> 📁 [File ${attachment["title"]}](${attachment["url"]})\n`;
							break;
						case AttachmentType.LINK:
							formatted += `> 🔗 [ ${attachment["title"] ? attachment["title"] : attachment["url"]} ](${attachment["url"]})\n`;
							break;
						default:
							formatted += `> ❓️ Unhandled attachment of type ${attachment.type}\n`;
							break;
					}
				});
			}
			if (f.hasForwards) {
				(await this.appendForwards(puppetId, "", f.forwards)).trim().split("\n").forEach((element) => {
					formatted += `> ${element}\n`;
				});
			}
			formatted += "\n";
		}
		return formatted;
	}

	public async renderWallPost(puppetId: number, post: MessagesMessageAttachment) {
		const user = await this.getRemoteUser(puppetId, Number(post.fromId));
		let formatted = `Forwarded post from [${user.name}](${user.externalUrl})\n`;
		post.text?.split("\n").forEach((element) => {
			formatted += `> ${element}\n`;
		});
		if (post.hasAttachments()) {
			post.attachments.forEach((attachment) => {
				switch (attachment.type) {
					case AttachmentType.PHOTO:
						formatted += `> 🖼️ [Photo](${attachment["largeSizeUrl"]})\n`;
						break;
					case AttachmentType.STICKER:
						formatted += `> 🖼️ [Sticker](${attachment["imagesWithBackground"][4]["url"]})\n`;
						break;
					case AttachmentType.AUDIO_MESSAGE:
						formatted += `> 🗣️ [Audio message](${attachment["oggUrl"]})\n`;
						break;
					case AttachmentType.DOCUMENT:
						formatted += `> 📁 [File ${attachment["title"]}](${attachment["url"]})\n`;
						break;
					case AttachmentType.LINK:
						formatted += `> 🔗 [ ${attachment["title"] ? attachment["title"] : attachment["url"]} ](${attachment["url"]})\n`;
						break;
					default:
						formatted += `> ❓️ Unhandled attachment of type ${attachment.type}\n`;
						break;
				}
			});
		}
		return formatted;
	}
}
