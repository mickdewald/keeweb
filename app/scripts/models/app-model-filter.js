import { Events } from 'framework/events';
import { SearchResultCollection } from 'collections/search-result-collection';
import { AppSettingsModel } from 'models/app-settings-model';
import { EntryModel } from 'models/entry-model';
import { GroupModel } from 'models/group-model';
import { Locale } from 'util/locale';
import { StringFormat } from 'util/formatting/string-format';
import { MenuItemModel } from 'models/menu/menu-item-model';

const AppModelFilterMixin = {
    _addTags(file) {
        const tagsHash = {};
        this.tags.forEach((tag) => {
            tagsHash[tag.toLowerCase()] = true;
        });
        file.forEachEntry({}, (entry) => {
            for (const tag of entry.tags) {
                if (!tagsHash[tag.toLowerCase()]) {
                    tagsHash[tag.toLowerCase()] = true;
                    this.tags.push(tag);
                }
            }
        });
        this.tags.sort();
    },

    _tagsChanged() {
        const section = this.menu.allItemsSection;
        while (section.items.length > 1) {
            section.items.pop();
        }
        if (this.tags.length) {
            const tagItems = this.tags.map((tag) => {
                return new MenuItemModel({
                    title: tag,
                    icon: 'tag',
                    filterKey: 'tag',
                    filterValue: tag,
                    editable: true
                });
            });
            section.addItem({
                title: StringFormat.capFirst(Locale.tags),
                icon: 'tags',
                expanded: !!AppSettingsModel.tagsMenuExpanded || !!this.filter.tag,
                items: tagItems,
                sectionHeader: true,
                persistExpandedKey: 'tagsMenuExpanded',
                cls: 'menu__item--disclosure'
            });
        } else {
            section.emit('change-items');
        }
    },

    _presentGroupsMenu() {
        const singleFile = this.files.length <= 1;
        let hasVisibleSubgroups = false;
        for (const root of this.menu.groupsSection.items) {
            if (singleFile && root.top) {
                root.cls = 'menu__item--hide-self';
                if (!root.expanded) {
                    root.expanded = true;
                }
                if (root.items) {
                    hasVisibleSubgroups = root.items.some((group) => group.visible !== false);
                }
            } else {
                root.cls = null;
                hasVisibleSubgroups = true;
            }
        }
        const showGroups = !singleFile || hasVisibleSubgroups;
        this.menu.groupsSection.visible = showGroups;
        this.menu.groupsSection.grow = showGroups;
    },

    updateTags() {
        const oldTags = this.tags.slice();
        this.tags.splice(0, this.tags.length);
        for (const file of this.files) {
            this._addTags(file);
        }
        if (oldTags.join(',') !== this.tags.join(',')) {
            this._tagsChanged();
        }
    },

    renameTag(from, to) {
        this.files.forEach((file) => file.renameTag && file.renameTag(from, to));
        this.updateTags();
    },

    emptyTrash() {
        this.files.forEach((file) => file.emptyTrash && file.emptyTrash());
        this.refresh();
    },

    setFilter(filter) {
        const keepAttachments =
            filter.attachments === undefined && this.filter && this.filter.attachments;
        this.filter = this.prepareFilter(filter);
        if (keepAttachments) {
            this.filter.attachments = true;
        }
        this.filter.subGroups = this.settings.expandGroups;
        if (!this.filter.advanced && this.advancedSearch) {
            this.filter.advanced = this.advancedSearch;
        }
        const entries = this.getEntries();
        if (!this.activeEntryId || !entries.get(this.activeEntryId)) {
            const firstEntry = entries[0];
            this.activeEntryId = firstEntry ? firstEntry.id : null;
        }
        Events.emit('filter', { filter: this.filter, sort: this.sort, entries });
        Events.emit('entry-selected', entries.get(this.activeEntryId));
    },

    refresh() {
        this._presentGroupsMenu();
        this.setFilter(this.filter);
    },

    selectEntry(entry) {
        this.activeEntryId = entry.id;
        this.refresh();
    },

    addFilter(filter) {
        this.setFilter(Object.assign(this.filter, filter));
    },

    setSort(sort) {
        this.sort = sort;
        this.setFilter(this.filter);
    },

    getEntries() {
        const entries = this.getEntriesByFilter(this.filter, this.files);
        entries.sortEntries(this.sort, this.filter);
        if (this.filter.trash) {
            this.addTrashGroups(entries);
        }
        return entries;
    },

    getEntriesByFilter(filter, files) {
        const preparedFilter = this.prepareFilter(filter);
        const entries = new SearchResultCollection();

        const devicesToMatchOtpEntries = files.filter((file) => file.backend === 'otp-device');

        const matchedOtpEntrySet = this.settings.yubiKeyMatchEntries ? new Set() : undefined;

        files
            .filter((file) => file.backend !== 'otp-device')
            .forEach((file) => {
                file.forEachEntry(preparedFilter, (entry) => {
                    if (matchedOtpEntrySet) {
                        for (const device of devicesToMatchOtpEntries) {
                            const matchingEntry = device.getMatchingEntry(entry);
                            if (matchingEntry) {
                                matchedOtpEntrySet.add(matchingEntry);
                            }
                        }
                    }
                    entries.push(entry);
                });
            });

        if (devicesToMatchOtpEntries.length) {
            for (const device of devicesToMatchOtpEntries) {
                device.forEachEntry(preparedFilter, (entry) => {
                    if (!matchedOtpEntrySet || !matchedOtpEntrySet.has(entry)) {
                        entries.push(entry);
                    }
                });
            }
        }

        return entries;
    },

    addTrashGroups(collection) {
        this.files.forEach((file) => {
            const trashGroup = file.getTrashGroup && file.getTrashGroup();
            if (trashGroup) {
                trashGroup.getOwnSubGroups().forEach((group) => {
                    collection.unshift(GroupModel.fromGroup(group, file, trashGroup));
                });
            }
        });
    },

    prepareFilter(filter) {
        filter = { ...filter };

        filter.textLower = filter.text ? filter.text.toLowerCase() : '';
        filter.textParts = null;
        filter.textLowerParts = null;

        const exact = filter.advanced && filter.advanced.exact;
        if (!exact && filter.text) {
            const textParts = filter.text.split(/\s+/).filter((s) => s);
            if (textParts.length) {
                filter.textParts = textParts;
                filter.textLowerParts = filter.textLower.split(/\s+/).filter((s) => s);
            }
        }

        filter.tagLower = filter.tag ? filter.tag.toLowerCase() : '';

        return filter;
    },

    getFirstSelectedGroupForCreation() {
        const selGroupId = this.filter.group;
        let file, group;
        if (selGroupId) {
            this.files.some((f) => {
                file = f;
                group = f.getGroup(selGroupId);
                return group;
            });
        }
        if (!group) {
            file = this.files.find((f) => f.active && !f.readOnly);
            group = file.groups[0];
        }
        return { group, file };
    },

    completeUserNames(part) {
        const userNames = {};
        this.files.forEach((file) => {
            file.forEachEntry(
                { text: part, textLower: part.toLowerCase(), advanced: { user: true } },
                (entry) => {
                    const userName = entry.user;
                    if (userName) {
                        userNames[userName] = (userNames[userName] || 0) + 1;
                    }
                }
            );
        });
        const matches = Object.entries(userNames);
        matches.sort((x, y) => y[1] - x[1]);
        const maxResults = 5;
        if (matches.length > maxResults) {
            matches.length = maxResults;
        }
        return matches.map((m) => m[0]);
    },

    getEntryTemplates() {
        const entryTemplates = [];
        this.files.forEach((file) => {
            file.forEachEntryTemplate?.((entry) => {
                entryTemplates.push({ file, entry });
            });
        });
        return entryTemplates;
    },

    canCreateEntries() {
        return this.files.some((f) => f.active && !f.readOnly);
    },

    createNewEntry(args) {
        const sel = this.getFirstSelectedGroupForCreation();
        if (args?.template) {
            if (sel.file !== args.template.file) {
                sel.file = args.template.file;
                sel.group = args.template.file.groups[0];
            }
            const templateEntry = args.template.entry;
            const newEntry = EntryModel.newEntry(sel.group, sel.file);
            newEntry.copyFromTemplate(templateEntry);
            return newEntry;
        } else {
            return EntryModel.newEntry(sel.group, sel.file, {
                tag: this.filter.tag
            });
        }
    },

    createNewEntryWithFields(group, fields) {
        return EntryModel.newEntryWithFields(group, fields);
    },

    createNewGroup() {
        const sel = this.getFirstSelectedGroupForCreation();
        return GroupModel.newGroup(sel.group, sel.file);
    },

    createNewGroupWithName(group, file, name) {
        const newGroup = GroupModel.newGroup(group, file);
        newGroup.setName(name);
        return newGroup;
    },

    createNewTemplateEntry() {
        const file = this.getFirstSelectedGroupForCreation().file;
        const group = file.getEntryTemplatesGroup() || file.createEntryTemplatesGroup();
        return EntryModel.newEntry(group, file);
    }
};

export { AppModelFilterMixin };
