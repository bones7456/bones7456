#!/usr/bin/env python
# encoding: utf-8
import gtk, webkit, os.path, re

reg = re.compile(r'\{\{(.+?\|.+?\|.+?)\}\}')
reg1 = re.compile(r'&lt;py&gt;')
reg2 = re.compile(r'&lt;/py&gt;')
cat = {
'字体图片':'1b',
'字源图片':'zy',
'字形图片':'zx'
}
__Label_style__ = '<span size="xx-large" weight="ultrabold">%s</span>'

class WV(webkit.WebView):
    '''webkit 浏览器，显示字的信息'''
    def __init__(self, html=''):
        webkit.WebView.__init__(self)
        self.runpath = os.path.dirname(os.path.abspath(__file__))
        if not html:
            html = os.path.join(self.runpath, 'welcome.html')
        self.open(html)
    def open(self, html):
        webkit.WebView.open(self, html)
    def show(self, c):
        from wikimarkup import parse
        f = os.path.join(self.runpath, 'data', '%s.wiki' % c)
        if os.path.exists(f):
            wiki = open(f).read()
            wiki = reg.sub(self._pic, wiki)
            wiki = reg1.sub(' (', wiki)
            wiki = reg2.sub(')', wiki)
            html = parse(wiki, showToc=False)
            self.load_html_string(html, 'file:///')
        else:
            self.open(os.path.join(self.runpath, 'err.html'))
        
    def _pic(self, m):
        i1, i2, i3 = m.group(1).split('|')
        f = '_'.join([cat[i1], i2, i3]) + '.gif'
        f = os.path.join(self.runpath, 'pic', f)
        return '<img src="%s"/>' % f    

__WV__ = WV()

class Name(gtk.VBox):
    '''名字'''
    def __init__(self):
        gtk.VBox.__init__(self)
        self.label = gtk.Label('×')
        self.label.set_use_markup(True)
        self.ev = gtk.EventBox()
        self.ev.add(self.label)
        self.ev.connect('button-press-event', 
            lambda o,e:__WV__.show(self.label.get_text().decode('utf8')[0]))
        self.b = gtk.Button('换字')
        self.b.connect('clicked', self.choose)
        self.pack_start(self.ev)
        self.pack_start(self.b, False)
    def setn(self, char):
        self.label.set_label(__Label_style__ % char)
    def choose(self, o):
        self.setn('哈')
        
class FName(gtk.VBox):
    '''姓'''
    def __init__(self):
        gtk.VBox.__init__(self)
        self.label = gtk.Label()
        self.label.set_use_markup(True)
        self.setn('李')
        self.ev = gtk.EventBox()
        self.ev.add(self.label)
        self.ev.connect('button-press-event', 
            lambda o,e:__WV__.show(self.label.get_text().decode('utf8')[0]))
        self.s = gtk.Entry()
        self.s.connect('activate',
            lambda o:self.setn(o.get_text().decode('utf8')[0]))
        self.pack_start(self.ev)
        self.pack_start(self.s,False)
    def setn(self, char):
        self.label.set_label(__Label_style__ % char)
        
class MainWindow:
    def __init__(self):
        self.window = gtk.Window()
        self.window.set_default_size(900, 600)
        self.window.set_title('cName')

        self.hbox = gtk.HBox(False, 0)
        
        self.fn = FName()
        self.n1 = Name()
        self.n2 = Name()
        self.hbox.pack_start(self.fn, False, False)
        self.hbox.pack_start(self.n1, False, False)
        self.hbox.pack_start(self.n2, False, False)
        sw = gtk.ScrolledWindow()
        sw.add(__WV__)
        self.hbox.pack_start(sw)

        self.window.add(self.hbox)
        self.window.connect("delete_event", self.on_close)
        self.window.show_all()
        
    def refresh(self, obj):
        __WV__.show(obj.get_text().decode('utf8')[0])
        
    def on_close(self, *args):
        gtk.main_quit()

def main():
    gtk.gdk.threads_init()
    m = MainWindow()
    gtk.gdk.threads_enter()
    gtk.main()
    gtk.gdk.threads_leave()

if __name__ == '__main__':
    main()

