'use strict';

// Load modules

const Os = require('os');
const Util = require('util');
const Stream = require('stream');
const Hoek = require('hoek');
const Wreck = require('wreck');
const Stringify = require('fast-safe-stringify');
const Moment = require('moment');


// Declare internals

const internals = {
    defaults: {
        slack: { },
        format: 'YYMMDD/HHmmss.SSS',
        host: Os.hostname()
    }
};


internals.utility = {
    codeFormat: (data) => Util.format('```\n%s\n```', data),

    createAttachment(event, payload, config) {

        const time = Moment.utc(event.timestamp).format(config.format);

        const defaults = {
            pretext: Util.format('`%s` event from *%s* at %s', event.event,
                config.host, time),
            'mrkdwn_in': ['pretext', 'text', 'fields']
        };

        return Hoek.merge(defaults, payload);
    },

    formatOps(event) {

        const mem = Math.round(event.proc.mem.rss / (1024 * 1024)) + ' Mb.';
        const load = event.os.load.map((v) => v.toFixed(2));

        return {
            fallback: `L: ${load[1]} | M: ${mem} | U: ${event.proc.uptime}`,
            fields: [
                {
                    title: 'Memory',
                    value: mem,
                    short: true
                }, {
                    title: 'Uptime (seconds)',
                    value: event.proc.uptime,
                    short: true
                }, {
                    title: 'Load',
                    value: load.join(' | '),
                    short: true
                }
            ]
        };
    },

    formatResponse(event) {

        const method = event.method.toUpperCase();
        const query = Stringify(event.query);

        const text = `*${method}* ${event.path} ${query} ${event.statusCode} ` +
            `(${event.responseTime}ms)`;

        return {
            fallback: `${event.statusCode} ${method} ${event.path}`,
            color: event.statusCode >= 400 ? 'danger' : 'good',
            text
        };
    },

    formatError(event) {

        const message = `${event.error.name}: ${event.error.message}`;

        return {
            fallback: message,
            text: `*${event.method.toUpperCase()}* ${event.url.path}`,
            color: 'danger',
            fields: [
                {
                    title: 'Error',
                    value: message
                }, {
                    title: 'Stack',
                    value: internals.utility.codeFormat(event.error.stack)
                }
            ]
        };
    },

    formatRequest(event) {

        let data = event.data;
        let message = event.data;

        const text = `*${event.method.toUpperCase()}* ${event.path}`;
        const tags = event.tags.join(', ');

        if (typeof event.data === 'object') {
            data = internals.utility.codeFormat(Stringify(event.data, null, 2));
            message = Stringify(event.data);
        }

        return {
            fallback: `${tags} ${message}`,
            text: text,
            color: event.tags.indexOf('error') > -1 ? 'danger' : undefined,
            fields: [
                { title: 'PID', value: event.pid },
                { title: 'Request ID', value: event.id },
                { title: 'Tags', value: tags },
                { title: 'Data', value: data }
            ]
        };
    },

    formatDefault(event) {

        const tags = event.tags || [];
        let data = event.data;
        let message = event.data;

        if (typeof event.data === 'object') {
            data = internals.utility.codeFormat(Stringify(event.data, null, 2));
            message = Stringify(event.data);
        }

        return {
            fallback: `${tags} ${message}`.trim(),
            fields: [
                { title: 'Tags', value: tags.toString() },
                { title: 'Data', value: data }
            ]
        };
    }
};


class GoodSlack extends Stream.Writable {

    constructor(config) {

        config = config || {};

        Hoek.assert(typeof config.url === 'string', 'url must be a string');

        super({ objectMode: true });
        this._config = Hoek.applyToDefaults(internals.defaults, config);
    }

    _write(data, encoding, next) {

        let content;

        switch (data.event) {
            case 'ops':
                content = internals.utility.formatOps(data);
                break;
            case 'response':
                content = internals.utility.formatResponse(data);
                break;
            case 'error':
                content = internals.utility.formatError(data);
                break;
            case 'request':
                content = internals.utility.formatRequest(data);
                break;
            default:
                content = internals.utility.formatDefault(data);
        }

        const attachment = internals.utility.createAttachment(data, content, this._config);
        this._send(attachment, next);
    }

    _send(attachment, callback) {

        const payload = Hoek.applyToDefaults(this._config.slack, {
            attachments: [attachment]
        });

        const data = {
            payload: Stringify(payload)
        };

        Wreck.post(this._config.url, data, callback);
    }
}


module.exports = GoodSlack;
