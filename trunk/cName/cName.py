#!/usr/bin/env python
# encoding: utf-8
import gtk, webkit, os.path, re
from random import choice

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
import load_data
__ALL__, __BU__, __HUA__, __YIN__ = load_data.load()
__BLACK__, __BLACK_BU__ = load_data.black()
__BLACK_REF__ = None

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
        hbox = gtk.HBox()
        black_this = gtk.Button('烂字')
        black_this.connect('button-press-event',
            lambda o,e:self.b_this(self.label.get_text().decode('utf8')[0]))
        black_bu = gtk.Button('烂部首')
        black_bu.connect('button-press-event',
            lambda o,e:self.b_bu(self.label.get_text().decode('utf8')[0]))
        hbox.pack_start(black_bu)
        hbox.pack_start(black_this)
        hbox2 = gtk.HBox()
        self.yin = gtk.Entry(max=2)
        self.yin.set_size_request(30, 20)
        self.yin.set_text('声母')
        self.yin.connect('activate', self.choose)
        self.hua = gtk.Entry(max=2)
        self.hua.set_size_request(30, 20)
        self.hua.set_text('笔画')
        self.hua.connect('activate', self.choose)
        self.zhi = gtk.Entry(max=1)
        self.zhi.set_size_request(20, 20)
        self.zhi.set_text('?')
        self.zhi.connect('activate', self.choose)
        hbox2.pack_start(self.yin)
        hbox2.pack_start(self.hua)
        hbox2.pack_start(self.zhi)
        self.pack_start(self.ev)
        self.pack_start(self.b, False)
        self.pack_start(hbox, False)
        self.pack_start(hbox2, False)
    def setn(self, char):
        self.label.set_label(__Label_style__ % char)
    def choose(self, o):
        zhi = self.zhi.get_text().decode('utf8')
        if zhi != '' and zhi != '?':
            pass
        else:
            s = set(__ALL__)
            s -= set(__BLACK__)
            for key in __BLACK_BU__:
                if key in __BU__:
                    s -= set(__BU__[key])
            try:
                hua = int(self.hua.get_text().decode('utf8'))
            except:
                hua = 0
            if hua:
                s &= set(__HUA__[hua])
            yin = self.yin.get_text().decode('utf8')
            if yin not in ['无字', '声母', '']:
                yins = set()
                for key in __YIN__:
                    if key.startswith(yin):
                        yins |= set(__YIN__[key])
                if len(yins) == 0:
                    self.yin.set_text('无字')
                else:
                    s &= yins
            if hua:
                s &= set(__HUA__[hua])
            print 'L:',len(s)
            zhi = choice(list(s))
        self.setn(zhi)
        __WV__.show(self.label.get_text().decode('utf8')[0])
    def b_this(self, c):
        global __BLACK__
        if c not in __BLACK__:
            __BLACK__ += c
        __BLACK_REF__()
    def b_bu(self, c):
        global __BLACK_BU__
        bu, hua = load_data.parsechar(c)
        dialog = AskDialog('真的去掉“%s”这部首？这将阻止以下汉字：' % bu,
            ''.join(__BU__[bu]))
        response = dialog.run()
        dialog.destroy()
        if response == gtk.RESPONSE_YES:
            if bu not in __BLACK_BU__:
                __BLACK_BU__ += bu
            __BLACK_REF__()
        
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
        self.s = gtk.Entry(max=2)
        self.s.set_size_request(60, 40)
        self.s.connect('activate',
            lambda o:self.setn(o.get_text().decode('utf8')))
        label1 = gtk.Label('姓：')
        self.pack_start(self.ev)
        self.pack_start(gtk.Label(' '), False)
        self.pack_start(label1, False)
        self.pack_start(self.s, False)
    def setn(self, char):
        self.label.set_label(__Label_style__ % char)
        __WV__.show(self.label.get_text().decode('utf8')[0])
        
class Filter(gtk.VBox):
    '''过滤器'''
    def __init__(self):
        gtk.VBox.__init__(self)
        self.pack_start(gtk.Label('过滤器：'))
        self.pack_start(gtk.Label('烂字列表：'), False)
        self.black_e = gtk.Entry()
        self.black_e.connect('activate', self.text_change, 'zhi')
        self.pack_start(self.black_e, False)
        self.pack_start(gtk.Label('烂部首列表：'), False)
        self.black_bu_e = gtk.Entry()
        self.black_bu_e.connect('activate', self.text_change, 'bu')
        self.pack_start(self.black_bu_e, False)
        self.ref()
    def ref(self):
        self.black_e.set_text(__BLACK__)
        self.black_bu_e.set_text(__BLACK_BU__)
    def text_change(self, o, which):
        global __BLACK__, __BLACK_BU__
        if which == 'zhi':
            __BLACK__ = o.get_text().decode('utf8')
        else:
            __BLACK_BU__ = o.get_text().decode('utf8')
        #self.ref()
        
class AskDialog(gtk.MessageDialog):
    '''退出确认对话框'''
    def __init__(self, title, message):
        gtk.MessageDialog.__init__(self, None, gtk.DIALOG_MODAL, 
            gtk.MESSAGE_QUESTION, gtk.BUTTONS_YES_NO)
        self.set_markup('<big><b>%s</b></big>' % title)
        self.format_secondary_markup(message)
        
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
        
        self.vbox = gtk.VBox(False, 0)
        self.fliter = Filter()
        global __BLACK_REF__
        __BLACK_REF__ = self.fliter.ref
        self.google = gtk.Button('这个不错，google一下看！')
        self.google.connect('button-press-event', self.googleit)
        self.vbox.pack_start(self.hbox)
        self.vbox.pack_start(gtk.HSeparator(), False, False)
        self.vbox.pack_start(self.fliter)
        self.vbox.pack_start(gtk.HSeparator(), False, False)
        self.vbox.pack_start(self.google, False, False)
        
        sw = gtk.ScrolledWindow()
        sw.add(__WV__)
        
        self.all = gtk.HBox(False, 0)
        self.all.pack_start(self.vbox, False)
        self.all.pack_start(sw)

        self.window.add(self.all)
        self.window.connect("delete_event", self.on_close)
        self.window.show_all()
        
    def refresh(self, obj):
        __WV__.show(obj.get_text().decode('utf8')[0])
        
    def on_close(self, *args):
        global __BLACK__, __BLACK_BU__
        load_data.save((__BLACK__, __BLACK_BU__))
        gtk.main_quit()
    def googleit(self, o, e):
        name = self.fn.label.get_text().decode('utf8')
        name += self.n1.label.get_text().decode('utf8')
        if '×' != self.n2.label.get_text().decode('utf8'):
            name += self.n2.label.get_text().decode('utf8')
        __WV__.open('http://www.google.com/search?q=%s' % name)

def main():
    gtk.gdk.threads_init()
    m = MainWindow()
    gtk.gdk.threads_enter()
    gtk.main()
    gtk.gdk.threads_leave()

if __name__ == '__main__':
    main()

