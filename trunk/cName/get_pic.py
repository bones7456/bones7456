#!/usr/bin/env python
# encoding: utf-8

"""
根据data目录下的所有汉字的信息，得到汉字的图片。
"""

import os.path, re, urllib
reg = re.compile(r'\{\{(.+?\|.+?\|.+?)\}\}')
cat = {
'字体图片':'1b',
'字源图片':'zy',
'字形图片':'zx'
}

def do(arg, p, fs):
    for f in fs:
        wiki = open(os.path.join(p, f)).read()
        data = reg.findall(wiki)
        #print data
        for item in data:
            i1, i2, i3 = item.split('|')
            url = 'http://www.zdic.net/pic/' + cat[i1] + '/'
            if i2 != '1':
                url += i2 + '/'
            url += i3 + '.gif'
            f = os.path.join('pic', '_'.join([cat[i1], i2, i3]) + '.gif')
            if not os.path.exists(f):
                print url, '-->', f
                urllib.urlretrieve(url, f)
            else:
                print 'skip', f
    
if __name__ == '__main__':
    os.path.walk('./data', do, None)
    
