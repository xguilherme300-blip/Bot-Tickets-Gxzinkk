const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, REST, Routes, SlashCommandBuilder } = require('discord.js');
const config = require('./config.json');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.MessageContent
    ] 
});

// 1. Definição dos Comandos
const commands = [
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Cria o painel de suporte personalizado')
        .addStringOption(opt => opt.setName('titulo').setDescription('Título do painel').setRequired(true))
        .addStringOption(opt => opt.setName('descricao').setDescription('Descrição do painel').setRequired(true))
        .addStringOption(opt => opt.setName('texto_botao').setDescription('Texto do botão').setRequired(true))
        .addStringOption(opt => opt.setName('banner').setDescription('URL da imagem do banner').setRequired(false))
        .addStringOption(opt => opt.setName('cor').setDescription('Cor Hex (Ex: #ff0000)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('config-bot')
        .setDescription('Altera nome e avatar do bot (Apenas Owners)')
        .addStringOption(opt => opt.setName('nome').setDescription('Novo nome do bot').setRequired(false))
        .addStringOption(opt => opt.setName('avatar').setDescription('URL da nova foto de perfil').setRequired(false)),

    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Verifica a latência real do bot'),

    new SlashCommandBuilder()
        .setName('permissoes')
        .setDescription('Verifica seu nível de acesso no sistema'),

    new SlashCommandBuilder()
        .setName('add')
        .setDescription('Adiciona um membro ao ticket')
        .addUserOption(opt => opt.setName('usuario').setDescription('Usuário a ser adicionado').setRequired(true)),

    new SlashCommandBuilder()
        .setName('remove')
        .setDescription('Remove um membro do ticket')
        .addUserOption(opt => opt.setName('usuario').setDescription('Usuário a ser removido').setRequired(true))
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(config.token);

client.once('ready', async () => {
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log(`✅ Sistema Gxzinkk_ Online como: ${client.user.tag}`);
    } catch (error) {
        console.error("Erro ao registrar comandos:", error);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options, user, channel, member } = interaction;
    const isOwner = config.owners.includes(user.id);
    const isStaff = member.roles.cache.has(config.cargoStaff);

    // --- COMANDO: PING (SISTEMA ANTI-BUG) ---
    if (commandName === 'ping') {
        const sent = await interaction.reply({ content: '⚡ Calculando latência...', fetchReply: true, ephemeral: true });
        const pingWebsocket = client.ws.ping;
        const pingAPI = sent.createdTimestamp - interaction.createdTimestamp;

        const embedPing = new EmbedBuilder()
            .setTitle('🏓 Pong!')
            .setColor('#2F3136')
            .addFields(
                { name: '🌐 WebSocket', value: `\`${pingWebsocket}ms\``, inline: true },
                { name: '⚡ API Latency', value: `\`${pingAPI}ms\``, inline: true }
            );

        return interaction.editReply({ content: null, embeds: [embedPing] });
    }

    // --- COMANDO: PERMISSÕES ---
    if (commandName === 'permissoes') {
        const cargo = isOwner ? "👑 Dono (Owner)" : (isStaff ? "🛡️ Staff" : "👤 Usuário");
        return interaction.reply({ content: `Seu status atual: **${cargo}**`, ephemeral: true });
    }

    // --- COMANDO: CONFIG-BOT (PERSONALIZAÇÃO) ---
    if (commandName === 'config-bot') {
        if (!isOwner) return interaction.reply({ content: "❌ Acesso negado ao Owner.", ephemeral: true });
        
        const nome = options.getString('nome');
        const avatar = options.getString('avatar');

        if (nome) await client.user.setUsername(nome).catch(() => {});
        if (avatar) await client.user.setAvatar(avatar).catch(() => {});

        return interaction.reply({ content: "✅ Identidade do bot atualizada!", ephemeral: true });
    }

    // --- COMANDO: SETUP PAINEL ---
    if (commandName === 'setup') {
        if (!isOwner) return interaction.reply({ content: "❌ Apenas o Owner pode criar painéis.", ephemeral: true });

        const embed = new EmbedBuilder()
            .setTitle(options.getString('titulo'))
            .setDescription(options.getString('descricao'))
            .setColor(options.getString('cor') || '#5865F2')
            .setImage(options.getString('banner') || null);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('abrir_ticket')
                .setLabel(options.getString('texto_botao'))
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📩')
        );

        await channel.send({ embeds: [embed], components: [row] });
        return interaction.reply({ content: "✅ Painel enviado!", ephemeral: true });
    }

    // --- COMANDOS: ADD / REMOVE (TRAVA DENTRO DO TICKET) ---
    if (commandName === 'add' || commandName === 'remove') {
        if (!channel.name.startsWith('ticket-')) {
            return interaction.reply({ content: "❌ Este comando só pode ser usado dentro de um ticket!", ephemeral: true });
        }
        if (!isStaff) return interaction.reply({ content: "❌ Apenas Staff pode gerenciar membros.", ephemeral: true });

        const alvo = options.getUser('usuario');
        const permit = commandName === 'add';

        await channel.permissionOverwrites.edit(alvo.id, { 
            ViewChannel: permit, 
            SendMessages: permit 
        });

        return interaction.reply({ content: `${permit ? '✅' : '❌'} Usuário ${alvo} ${permit ? 'adicionado' : 'removido'}.` });
    }
});

// --- SISTEMA DE TICKET (INTERAÇÕES DE BOTÃO) ---
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    const { customId, user, guild, member } = interaction;
    const isStaff = member.roles.cache.has(config.cargoStaff);

    if (customId === 'abrir_ticket') {
        const canal = await guild.channels.create({
            name: `ticket-${user.username}`,
            type: ChannelType.GuildText,
            parent: config.categoriaTickets,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: config.cargoStaff, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
            ]
        });

        const embedStaff = new EmbedBuilder()
            .setTitle('🎫 Ticket de Atendimento')
            .setDescription(`Atendimento iniciado por: ${user}\n\n**Gestão de Ticket:**\nUtilize \`/add\` ou \`/remove\` para controlar os membros aqui.`)
            .setColor('#2F3136');

        const rowStaff = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('assumir').setLabel('Assumir').setStyle(ButtonStyle.Success).setEmoji('👤'),
            new ButtonBuilder().setCustomId('fechar').setLabel('Fechar').setStyle(ButtonStyle.Danger).setEmoji('🔒')
        );

        await canal.send({ content: `<@&${config.cargoStaff}>`, embeds: [embedStaff], components: [rowStaff] });
        return interaction.reply({ content: `✅ Ticket aberto: ${canal}`, ephemeral: true });
    }

    if (customId === 'assumir') {
        if (!isStaff) return interaction.reply({ content: "❌ Apenas Staff!", ephemeral: true });
        await interaction.channel.send({ content: `✅ O staff **${user.username}** assumiu o ticket.` });
        return interaction.reply({ content: "Você assumiu o atendimento.", ephemeral: true });
    }

    if (customId === 'fechar') {
        if (!isStaff) return interaction.reply({ content: "❌ Apenas Staff!", ephemeral: true });
        await interaction.reply("🔒 Encerrando canal em 5 segundos...");
        setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }
});

client.login(config.token);