import { IconSelectView } from 'views/icon-select-view';

const DetailsViewIcons = {
    setSelectedColor(color) {
        this.$el
            .find('.details__colors-popup > .details__colors-popup-item')
            .removeClass('details__colors-popup-item--active');
        const colorEl = this.$el.find('.details__header-color')[0];
        if (!colorEl) {
            return;
        }
        for (const cls of colorEl.classList) {
            if (cls.indexOf('color') > 0 && cls.lastIndexOf('details', 0) !== 0) {
                colorEl.classList.remove(cls);
            }
        }
        if (color) {
            this.$el
                .find('.details__colors-popup > .' + color + '-color')
                .addClass('details__colors-popup-item--active');
            colorEl.classList.add(color + '-color');
        }
    },

    selectColor(e) {
        let color = $(e.target).closest('.details__colors-popup-item').data('color');
        if (!color) {
            return;
        }
        if (color === this.model.color) {
            color = null;
        }
        this.model.setColor(color);
        this.entryUpdated();
    },

    toggleIcons() {
        if (this.model.backend) {
            return;
        }
        if (this.views.sub && this.views.sub instanceof IconSelectView) {
            this.render();
            return;
        }
        this.removeSubView();
        const subView = new IconSelectView(
            {
                iconId: this.model.customIconId || this.model.iconId,
                url: this.model.url,
                file: this.model.file
            },
            {
                parent: this.scroller[0],
                replace: true
            }
        );
        this.listenTo(subView, 'select', this.iconSelected);
        subView.render();
        this.pageResized();
        this.views.sub = subView;
    },

    iconSelected(sel) {
        if (sel.custom) {
            if (sel.id !== this.model.customIconId) {
                this.model.setCustomIcon(sel.id);
                this.entryUpdated();
            } else {
                this.render();
            }
        } else if (sel.id !== this.model.iconId) {
            this.model.setIcon(+sel.id);
            this.entryUpdated();
        } else {
            this.render();
        }
    }
};

export { DetailsViewIcons };
